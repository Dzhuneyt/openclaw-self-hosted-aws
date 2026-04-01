import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export class Network extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    this.securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc: this.vpc,
      description: "OpenClaw EC2 - zero inbound, restricted outbound",
      allowAllOutbound: false,
    });

    // Outbound only: HTTPS, HTTP, NTP (Tailscale handles all inbound)
    this.securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS"
    );
    this.securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "HTTP"
    );
    this.securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(123),
      "NTP"
    );
  }
}
