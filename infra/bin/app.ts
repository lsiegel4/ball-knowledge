#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

const app = new cdk.App();

// Every stack deploys into this account+region. CDK_DEFAULT_* are injected by
// the CDK CLI from your configured AWS creds (the ball-knowledge-cli user).
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

// Stacks get added here as we build them (AuthStack next — task #3).
void env;

app.synth();
