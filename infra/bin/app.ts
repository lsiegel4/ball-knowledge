#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack } from "../lib/api-stack";
import { RealtimeStack } from "../lib/realtime-stack";
import { HostingStack } from "../lib/hosting-stack";
import { DataStack } from "../lib/data-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

// Config-driven CORS allowlist. `spaOrigin` context adds the deployed SPA's
// origin without ApiStack referencing HostingStack. Pass via:
//   cdk deploy BallKnowledge-Api --context spaOrigin=https://xxxx.cloudfront.net
const spaOrigin = app.node.tryGetContext("spaOrigin") as string | undefined;
const allowedOrigins = [
  "http://localhost:5173",
  ...(spaOrigin ? [spaOrigin] : []),
];

const auth = new AuthStack(app, "BallKnowledge-Auth", { env });

const data = new DataStack(app, "BallKnowledge-Data", { env });

new ApiStack(app, "BallKnowledge-Api", {
  env,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  allowedOrigins,
  playersTable: data.playersTable,
});

new RealtimeStack(app, "BallKnowledge-Realtime", { env });

new HostingStack(app, "BallKnowledge-Hosting", { env });

app.synth();
