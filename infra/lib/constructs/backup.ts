import * as cdk from "aws-cdk-lib/core";
import * as backup from "aws-cdk-lib/aws-backup";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";

export class Backup extends Construct {
  public readonly vault: backup.BackupVault;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vault = new backup.BackupVault(this, "Vault", {
      backupVaultName: "openclaw-ebs-vault",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const plan = new backup.BackupPlan(this, "Plan", {
      backupPlanName: "openclaw-daily",
      backupPlanRules: [
        new backup.BackupPlanRule({
          ruleName: "DailyAt2AM",
          scheduleExpression: events.Schedule.cron({
            hour: "2",
            minute: "0",
          }),
          deleteAfter: cdk.Duration.days(7),
          backupVault: this.vault,
        }),
      ],
    });

    // Select resources tagged with backup=openclaw
    plan.addSelection("TagSelection", {
      resources: [
        backup.BackupResource.fromTag("backup", "openclaw"),
      ],
    });
  }
}
