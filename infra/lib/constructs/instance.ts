import { readFileSync } from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface InstanceProps {
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
  tailscaleAuthKeyParamArn: string;
}

export class Instance extends Construct {
  public readonly instance: ec2.Instance;

  constructor(scope: Construct, id: string, props: InstanceProps) {
    super(scope, id);

    const role = new iam.Role(this, "Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [props.tailscaleAuthKeyParamArn],
      })
    );

    const userData = ec2.UserData.forLinux();
    const bootstrapScript = readFileSync(
      path.join(__dirname, "..", "user-data", "bootstrap.sh"),
      "utf-8"
    );
    // Strip shebang — UserData.forLinux() already adds #!/bin/bash
    userData.addCommands(bootstrapScript.replace(/^#!\/bin\/bash\n/, ""));

    this.instance = new ec2.Instance(this, "Instance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: props.securityGroup,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM
      ),
      machineImage: ec2.MachineImage.lookup({
        name: "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*",
        owners: ["099720109477"],
      }),
      role,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
      requireImdsv2: true,
      userDataCausesReplacement: true,
    });

    // Persistent data volume — survives instance replacement
    const dataVolume = new ec2.CfnVolume(this, "DataVolume", {
      availabilityZone: this.instance.instanceAvailabilityZone,
      size: 30,
      volumeType: "gp3",
      encrypted: true,
      tags: [
        { key: "Name", value: "openclaw-data" },
        { key: "backup", value: "openclaw" },
      ],
    });
    dataVolume.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new ec2.CfnVolumeAttachment(this, "DataVolumeAttachment", {
      instanceId: this.instance.instanceId,
      volumeId: dataVolume.ref,
      device: "/dev/sdf",
    });
  }
}
