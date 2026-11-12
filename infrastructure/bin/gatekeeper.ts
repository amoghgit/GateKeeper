#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { GateKeeperStack } from "../lib/gatekeeper-stack";

/**
 * Usage:  npx cdk deploy -c stage=dev -c appOrigin=https://your-web-host [-c alarmEmail=ops@example.com] [-c smsEnabled=true]
 * Nothing is deployed unless an operator runs `cdk deploy` with credentials.
 */
const app = new App();
const stage = (app.node.tryGetContext("stage") ?? "dev") as "dev" | "prod";
if (stage !== "dev" && stage !== "prod") throw new Error('stage must be "dev" or "prod"');
const appOrigin = app.node.tryGetContext("appOrigin") ?? "http://localhost:3000";
if (stage === "prod" && !String(appOrigin).startsWith("https://")) throw new Error("prod requires an https appOrigin");

new GateKeeperStack(app, `GateKeeper-${stage}`, {
  stage,
  appOrigin,
  alarmEmail: app.node.tryGetContext("alarmEmail"),
  smsEnabled: app.node.tryGetContext("smsEnabled") === "true",
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description: `GateKeeper visitor management (${stage}) — serverless, pay-per-use`,
});
