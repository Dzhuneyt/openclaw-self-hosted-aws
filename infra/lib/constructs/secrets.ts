import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export class Secrets extends Construct {
  public readonly tailscaleAuthKeyParam: ssm.StringParameter;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.tailscaleAuthKeyParam = new ssm.StringParameter(
      this,
      "TAILSCALE_AUTH_KEY",
      {
        parameterName: "/openclaw/tailscale/auth-key",
        stringValue: "CHANGE_ME",
        description:
          'Tailscale auth key -- replace post-deploy with: aws ssm delete-parameter --name "/openclaw/tailscale/auth-key" && aws ssm put-parameter --name "/openclaw/tailscale/auth-key" --value "..." --type SecureString',
      }
    );
  }
}
