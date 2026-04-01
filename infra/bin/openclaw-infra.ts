#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib/core";
import { OpenClawStack } from "../lib/openclaw-stack";

const app = new cdk.App();
new OpenClawStack(app, "OpenClawStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "eu-central-1",
  },
});
