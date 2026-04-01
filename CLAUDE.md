# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is
AWS CDK (TypeScript) project to deploy a self-hosted OpenClaw instance natively on EC2 with Tailscale and zero public ports.

## Key Details
- **Region**: eu-central-1
- **Instance**: t3.medium, Ubuntu 24.04 LTS
- **Instance ID**: <YOUR_INSTANCE_ID>
- **Access**: Tailscale (mesh VPN) + SSM Session Manager (no SSH)
- **Dashboard**: https://openclaw-ec2.<YOUR_TAILNET>.ts.net/
- **Secrets**: Single SSM parameter for Tailscale auth key (`/openclaw/tailscale/auth-key`)
- **Backups**: Daily EBS snapshots, 7-day retention

## AWS Credentials
- Ensure AWS CLI credentials are configured for the target account (via environment variables, `~/.aws/credentials`, SSO, or a credential wrapper like aws-vault)
- Example: `pnpm exec cdk synth`

## CDK Commands (run from `infra/`)
- `pnpm exec cdk synth` — synthesize CloudFormation template
- `pnpm exec cdk deploy` — deploy stack
- `pnpm exec cdk diff` — compare deployed vs local
- `pnpm exec cdk bootstrap` — bootstrap CDK
- Never `npm build` CDK apps. CDK uses ts-node directly (`cdk.json` → `npx ts-node --prefer-ts-exts`), so no build step is needed.
- No tests in the project currently.

## Architecture
Single-stack CDK app (`OpenClawStack`) composed of 4 constructs wired together in `openclaw-stack.ts`:
- **Network** → VPC (public subnets only, no NAT) + security group (zero inbound, outbound restricted to HTTPS/HTTP/NTP)
- **Secrets** → Single SSM String parameter for Tailscale auth key (CHANGE_ME placeholder, replaced post-deploy with SecureString)
- **Instance** → EC2 + IAM role (SSM + parameter read) + user data from `bootstrap.sh` + persistent data volume (CfnVolume at `/data`, survives instance replacement). Has `userDataCausesReplacement: true` so CloudFormation auto-replaces the instance when user data changes.
- **Backup** → AWS Backup vault + daily plan targeting the data volume tagged `backup=openclaw`

The stack wiring: Network exposes `vpc` + `securityGroup` → Instance consumes both plus `tailscaleAuthKeyParamArn` from Secrets. Backup is independent (selects resources by tag).

The bootstrap script (`user-data/bootstrap.sh`) is read at synth time and injected into EC2 UserData. It mounts the persistent data volume, installs Docker, Node 22, OpenClaw (`npm install -g openclaw@latest`), and Tailscale. OpenClaw runs natively on the host (not in Docker) and is configured via interactive onboarding post-deploy.

## SSM Parameters (must be set post-deploy)
- `/openclaw/tailscale/auth-key` — the only SSM parameter; all other config handled by `openclaw onboard --install-daemon`

## Running Commands on the Instance

### SSM Send-Command (non-interactive)
For multi-line scripts, write to a temp file, JSON-encode it, then send:
```bash
COMMANDS=$(cat <<'SCRIPT' | jq -Rs '.'
sudo -iu ubuntu openclaw devices list
SCRIPT
) && \
aws ssm send-command \
  --instance-ids "<YOUR_INSTANCE_ID>" \
  --document-name "AWS-RunShellScript" \
  --parameters "{\"commands\": [$COMMANDS]}" \
  --region eu-central-1 \
  --output json | jq -r '.Command.CommandId'

# Retrieve output (most commands complete in 1-3 seconds)
sleep 2 && aws ssm get-command-invocation \
  --command-id "<COMMAND_ID>" \
  --instance-id "<YOUR_INSTANCE_ID>" \
  --region eu-central-1 \
  --query "StandardOutputContent" --output text
```

### SSM Interactive Session
```bash
aws ssm start-session \
  --target <YOUR_INSTANCE_ID> --region eu-central-1
```
SSM sessions run as `ssm-user`. Always `sudo -iu ubuntu` before running OpenClaw commands.

## OpenClaw on the Instance

### Gateway management
```bash
sudo systemctl status openclaw-gateway      # check status
sudo systemctl restart openclaw-gateway     # restart after config changes
journalctl -u openclaw-gateway --no-pager -n 50  # view logs
```

### Config changes
```bash
sudo -iu ubuntu openclaw config set <key> <value>
# Then restart: sudo systemctl restart openclaw-gateway
```

### Device pairing (when browsers connect)
```bash
sudo -iu ubuntu openclaw devices list
sudo -iu ubuntu openclaw devices approve <requestId>
```

### Key config values
- `gateway.mode` = `local` (agents run on host)
- `gateway.bind` = `loopback`
- `gateway.tailscale.mode` = `serve` (HTTPS via MagicDNS)
- `channels.slack.groupPolicy` = `open` (respond in all channels bot is invited to)
- `channels.slack.dmPolicy` = `open` (accept DMs from anyone)
- `channels.slack.allowFrom` = `["*"]` (no sender restrictions)
- `channels.slack.channels.<YOUR_SLACK_CHANNEL_ID>.requireMention` = `false` (no @mention needed in bound channel)

### Per-channel mention overrides
In `~/.openclaw/openclaw.json` under `channels.slack.channels`:
```json
{
  "<YOUR_SLACK_CHANNEL_ID>": {
    "allow": true,
    "requireMention": false
  }
}
```
Docs: https://docs.openclaw.ai/channels/groups

### Updating OpenClaw
```bash
sudo npm install -g openclaw@latest    # update binary
sudo systemctl restart openclaw-gateway # restart to pick up new version
sudo -iu ubuntu openclaw --version      # verify
```
`openclaw update` (without sudo) fails with EACCES on this instance because the binary is in `/usr/lib/node_modules/`.

### Debugging Slack issues
```bash
sudo -iu ubuntu openclaw channels status --probe   # check channel health
sudo -iu ubuntu openclaw doctor                      # config diagnostics
# Session files (agent conversation history):
ls /home/ubuntu/.openclaw/agents/main/sessions/
```

## Agents

Two agents are configured on the instance:

### main (default)
- **Workspace**: `~/.openclaw/workspace`
- **Routing**: Handles all Slack channels and DMs not matched by other agents

### example-agent
- **Workspace**: `~/.openclaw/workspace-example-agent`
- **Slack channel**: `#example-channel` (private, channel ID: `<YOUR_SLACK_CHANNEL_ID>`)
- **Routing**: Bound via `bindings` in `openclaw.json` with `peer.kind: "channel"`
- **Mention**: `requireMention: false` — responds to all messages without @mention
- **Purpose**: Example domain-specific agent (customize for your use case)
- **Session files**: `~/.openclaw/agents/example-agent/sessions/`

### Agent management
```bash
sudo -iu ubuntu openclaw agents list              # list all agents
sudo -iu ubuntu openclaw agents list --bindings    # show routing rules
```

### Adding a new agent binding
In `~/.openclaw/openclaw.json`, add to the `bindings` array:
```json
{
  "agentId": "<agent-id>",
  "match": {
    "channel": "slack",
    "peer": { "kind": "channel", "id": "<SLACK_CHANNEL_ID>" }
  }
}
```
Then restart: `sudo systemctl restart openclaw-gateway`

## Gotchas
- EC2 security group descriptions must be ASCII only (no em-dashes)
- `awscli` apt package doesn't exist on Ubuntu 24.04 — use AWS CLI v2 official zip installer
- `UserData.forLinux()` adds `#!/bin/bash` automatically — bootstrap.sh shebang is stripped at synth time
- OpenClaw onboarding is interactive — cannot be automated in cloud-init
- SSM SecureString parameters cannot be created via CloudFormation/CDK — created as String with CHANGE_ME placeholders, replaced manually post-deploy
- Data volume device name may differ on Nitro instances — bootstrap.sh probes `/dev/nvme1n1`, `/dev/sdf`, `/dev/xvdf`
- SSM sessions lack a D-Bus user session — `openclaw onboard --install-daemon` can't create systemd user services. Use a system-level service at `/etc/systemd/system/openclaw-gateway.service` instead.
- OpenClaw binary is at `/usr/bin/openclaw` (not `/usr/local/bin`) when installed via NodeSource + npm
- Changing SSM parameter construct IDs in CDK causes "already exists" errors — CloudFormation tries to create before deleting. Keep the construct ID as `TAILSCALE_AUTH_KEY` to match the deployed resource.
- Slack `groupPolicy: allowlist` with an empty allowlist silently drops all messages — use `open` for personal setups
- Multi-agent Slack bindings: use `peer.kind: "channel"` for Slack channels (not `"group"` — that's for WhatsApp/Telegram group chats). The lane name in logs shows the correct kind (e.g. `session:agent:main:slack:channel:<id>`)
- Writing files to EC2 via SSM: heredoc syntax breaks in JSON-encoded commands. Use base64 encoding instead: write file locally, `base64 < file`, send via SSM with `echo '<b64>' | base64 -d > target`
- Slack event subscriptions: the Slack app must subscribe to `message.groups` (private channels), `message.channels` (public channels), and `message.im` (DMs) in the Slack API dashboard under Event Subscriptions → Subscribe to bot events. Without these, the bot only receives `app_mention` events and silently ignores non-mention messages — no amount of `requireMention: false` in openclaw.json will help.
- `openclaw doctor --fix` is interactive — cannot run via SSM send-command (hangs). Use an SSM interactive session instead.
- Agent "memory" is just the session JSONL file (conversation history). Clearing a session resets all learned behavior. The model has no persistent memory beyond the session context — if it was told "always reply without mentions" in conversation, that instruction lives in the session file and is replayed on every API call.

## Security Model
- Zero inbound ports on security group
- Tailscale for all remote access (Serve mode, tailnet-only HTTPS)
- IMDSv2 enforced, EBS encrypted
- Persistent data volume encrypted, RETAIN policy on stack deletion
