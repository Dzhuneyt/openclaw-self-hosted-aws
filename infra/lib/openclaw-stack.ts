import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { Network } from "./constructs/network";
import { Secrets } from "./constructs/secrets";
import { Instance } from "./constructs/instance";
import { Backup } from "./constructs/backup";

export class OpenClawStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const network = new Network(this, "Network");
    const secrets = new Secrets(this, "Secrets");
    const instance = new Instance(this, "Instance", {
      vpc: network.vpc,
      securityGroup: network.securityGroup,
      tailscaleAuthKeyParamArn:
        secrets.tailscaleAuthKeyParam.parameterArn,
    });
    const backups = new Backup(this, "Backup");

    new cdk.CfnOutput(this, "InstanceId", {
      value: instance.instance.instanceId,
    });

    new cdk.CfnOutput(this, "SSMConnectCommand", {
      value: `aws ssm start-session --target ${instance.instance.instanceId} --region eu-central-1`,
    });

    new cdk.CfnOutput(this, "BackupVaultArn", {
      value: backups.vault.backupVaultArn,
    });
  }
}
