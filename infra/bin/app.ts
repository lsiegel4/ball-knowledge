#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack } from "../lib/api-stack";
import { RealtimeStack } from "../lib/realtime-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const auth = new AuthStack(app, "BallKnowledge-Auth", { env });

new ApiStack(app, "BallKnowledge-Api", {
  env,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

new RealtimeStack(app, "BallKnowledge-Realtime", { env });

app.synth();
