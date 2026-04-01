# OpenClaw Personal VPS

<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/243c5947-f280-4b11-a940-cc28fb57a865" />


Self-hosted [OpenClaw](https://docs.openclaw.ai) on AWS EC2, deployed with CDK. Zero public ports — all access via Tailscale mesh VPN.

## Prerequisites

- AWS account with CDK bootstrapped in `eu-central-1`
- AWS CLI configured with credentials for your target account
- Node.js + pnpm installed locally
- A [Tailscale](https://tailscale.com) account with HTTPS enabled on the tailnet

## Architecture

Single CDK stack deploying:

- **EC2** (t3.medium, Ubuntu 24.04) running OpenClaw natively via `npm install -g openclaw@latest`
- **Persistent EBS volume** at `/data` — survives instance replacement, encrypted, RETAIN policy
- **Tailscale Serve** for HTTPS access to the gateway dashboard (no public ports)
- **SSM Session Manager** for shell access (no SSH)
- **AWS Backup** — daily EBS snapshots of the data volume, 7-day retention

The bootstrap script installs Docker, Node 22, OpenClaw, AWS CLI v2, and Tailscale. OpenClaw has full OS control and can launch its own Docker containers as needed.

## Deploy

```bash
cd infra
pnpm install
pnpm exec cdk deploy
```

## Post-Deploy Setup

### 1. Set Tailscale Auth Key

Generate a **reusable, pre-approved** auth key at https://login.tailscale.com/admin/settings/keys, then:

```bash
aws ssm delete-parameter \
  --name "/openclaw/tailscale/auth-key" --region eu-central-1

aws ssm put-parameter \
  --name "/openclaw/tailscale/auth-key" \
  --value "tskey-auth-YOUR_KEY_HERE" \
  --type SecureString --region eu-central-1
```

### 2. Connect Tailscale on the Instance

SSM into the instance:

```bash
aws ssm start-session \
  --target <INSTANCE_ID> --region eu-central-1
```

Switch to the `ubuntu` user (SSM sessions run as `ssm-user` by default):

```bash
sudo -iu ubuntu
```

Join the tailnet:

```bash
sudo tailscale up --authkey="tskey-auth-YOUR_KEY" --hostname=openclaw-ec2
```

### 3. Run OpenClaw Onboarding

Still as the `ubuntu` user:

```bash
openclaw onboard --install-daemon
```

The wizard will ask several questions. Recommended answers:

| Question | Answer |
|----------|--------|
| Gateway bind | **Loopback (127.0.0.1)** |
| Tailscale exposure | **Serve** |
| Reset Tailscale serve/funnel on exit? | **No** |
| Gateway mode | **local** (if asked separately, run `openclaw config set gateway.mode local`) |

The `--install-daemon` flag will fail to install a systemd user service (SSM sessions lack a D-Bus session). This is expected — we create a system-level service in the next step.

### 4. Create System-Level Systemd Service

The onboarding wizard can't create a systemd service via SSM (no user-level D-Bus). Create one manually:

```bash
sudo tee /etc/systemd/system/openclaw-gateway.service > /dev/null <<'EOF'
[Unit]
Description=OpenClaw Gateway
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Environment=PATH=/usr/bin:/bin
ExecStart=/usr/bin/openclaw gateway --tailscale serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-gateway
```

Verify it's running:

```bash
sudo systemctl status openclaw-gateway
```

### 5. Pair Your Browser

Open the gateway dashboard:

```
https://openclaw-ec2.<your-tailnet>.ts.net/
```

You'll see "disconnected (1008): pairing required". Approve the pairing request:

```bash
sudo -iu ubuntu openclaw devices list    # find the pending request ID
sudo -iu ubuntu openclaw devices approve <requestId>
```

Refresh the browser — the dashboard should connect.

## Slack Integration

### 1. Create a Slack App

At https://api.slack.com/apps, create a new app with:

**Socket Mode:** Enabled

**App-Level Token:** Generate one with `connections:write` scope

**Bot Token Scopes** (OAuth & Permissions):
- `app_mentions:read`, `chat:write`
- `channels:history`, `channels:read`
- `groups:history`, `groups:read`
- `im:history`, `mpim:history`
- `reactions:read`, `reactions:write`
- `pins:read`, `pins:write`
- `files:read`, `files:write`
- `users:read`, `emoji:read`, `commands`

**Event Subscriptions** (toggle ON, subscribe to bot events):
- `app_mention`
- `message.channels`, `message.groups`, `message.im`, `message.mpim`
- `reaction_added`, `reaction_removed`
- `member_joined_channel`, `member_left_channel`
- `channel_rename`, `pin_added`, `pin_removed`

**Install the app** to your workspace. Copy the Bot Token (`xoxb-...`) and App Token (`xapp-...`).

### 2. Configure OpenClaw

SSM in as `ubuntu`, then:

```bash
openclaw config set channels.slack.enabled true
openclaw config set channels.slack.mode socket
openclaw config set channels.slack.groupPolicy open
openclaw config set channels.slack.appToken "xapp-YOUR_APP_TOKEN"
openclaw config set channels.slack.botToken "xoxb-YOUR_BOT_TOKEN"
```

Restart the gateway:

```bash
exit  # back to ssm-user
sudo systemctl restart openclaw-gateway
```

### 3. Test

Invite the bot to a Slack channel, then mention it:

```
@OpenClaw hello
```

## Troubleshooting

### Check gateway status
```bash
sudo systemctl status openclaw-gateway
journalctl -u openclaw-gateway --no-pager -n 50
```

### Check bootstrap logs (after fresh deploy)
```bash
tail -100 /var/log/openclaw-bootstrap.log
```

### Slack connected but not responding
- Verify `groupPolicy` is `open` (not `allowlist` with empty list)
- Verify the app was **reinstalled** after adding event subscriptions
- Check `journalctl` for Slack-related errors

### Gateway starts but Tailscale Serve fails
- `tailscale serve` requires root — the systemd service handles this via `sudo`
- Verify HTTPS is enabled on your tailnet: https://login.tailscale.com/admin/dns

### Device pairing required after browser change
Each browser profile gets a unique device ID. Approve new devices with:
```bash
sudo -iu ubuntu openclaw devices list
sudo -iu ubuntu openclaw devices approve <requestId>
```

### Enable debug logging
```bash
sudo -iu ubuntu openclaw config set gateway.logLevel debug
sudo systemctl restart openclaw-gateway
# Check logs, then reset:
sudo -iu ubuntu openclaw config set gateway.logLevel info
sudo systemctl restart openclaw-gateway
```

## CDK Commands

Run from `infra/`:

```bash
pnpm exec cdk synth    # synthesize template
pnpm exec cdk deploy   # deploy
pnpm exec cdk diff     # compare local vs deployed
```
