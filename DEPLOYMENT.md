# Deployment

> **Nothing in this repository deploys automatically.** Every step below is run by an operator with AWS credentials, after reviewing `cdk diff`. No deployment has been performed from the build workspace.

## What gets created

`infrastructure/lib/gatekeeper-stack.ts` defines one stack, `GateKeeper-{stage}`:

| Resource | Notes | May incur charges? |
| --- | --- | --- |
| DynamoDB `MainTable` (+3 GSIs, TTL) and `AuditTable` | On-demand, AWS-managed encryption. PITR and deletion protection only for `prod`. Audit table is always retained on stack deletion. | Yes, per request and per GB (25 GB free) |
| Cognito user pool, web client, 3 groups | Self sign-up with e-mail verification | Free within the MAU allowance |
| 6 Lambda functions (Node 22, arm64, 512 MB) + log groups (30 days) | core / security / admin API, jobs, two Cognito triggers | Usually within the always-free allowance |
| API Gateway HTTP API, stage with throttling and access logs, JWT authorizer | | Yes, per request |
| S3 uploads bucket | Private, TLS-only, CORS for the app origin, 90-day expiry | Yes, small |
| S3 audit-anchor bucket | Object Lock (governance, 400 days), versioned, private, **always retained** | Yes, negligible (KB per checkpoint) |
| SNS notification topic and alarm topic | | E-mail mostly free; **SMS is billed** |
| 6 EventBridge scheduled rules | | No charge for scheduled rules |
| 4 CloudWatch alarms | | Free within 10 alarms |
| IAM roles/policies | Least privilege per function | No |

No EC2, RDS, NAT Gateway, load balancer or VPC is created.

## Prerequisites

1. AWS CLI v2 configured for the target account and region; **Node.js 22 LTS** (Node 20 reached end-of-life in April 2026; the Lambdas already run on Node 22).
   - **Windows + OneDrive:** CDK bundling renames folders inside `cdk.out`, which OneDrive can lock (`EPERM … rename`). Synthesize/deploy with an output directory outside synced folders, e.g. `npx cdk deploy -o %TEMP%\gatekeeper-cdk.out …`, or move the repository out of OneDrive.
2. Bootstrap CDK once: `npx cdk bootstrap aws://ACCOUNT_ID/REGION`.
3. Decide where the Next.js web tier will run (see step 6) and its HTTPS origin.

## Steps

```bash
# 1. Install and review
cd infrastructure
npm install
npm test                                            # infrastructure assertions
npx cdk synth -c stage=dev -c appOrigin=https://gatekeeper-dev.example.com
npx cdk diff  -c stage=dev -c appOrigin=https://gatekeeper-dev.example.com

# 2. Deploy (prompts for IAM changes)
npx cdk deploy -c stage=dev -c appOrigin=https://gatekeeper-dev.example.com \
  -c alarmEmail=ops@example.com            # optional
#   -c smsEnabled=true                     # only after reviewing SMS pricing & registration

# 3. Create secrets (SecureString parameters read by the Lambdas)
# Windows / Cross-platform:
npx tsx scripts/create-secrets.ts
# Or bash:
cd .. && STAGE=dev AWS_REGION=<region> ./scripts/create-secrets.sh

# 4. Bootstrap the first community and administrator (values from the stack outputs)
GATEKEEPER_MODE=AWS_PRODUCTION AWS_REGION=<region> \
TABLE_NAME=<TableName> AUDIT_TABLE_NAME=<AuditTableName> \
COGNITO_USER_POOL_ID=<UserPoolId> COGNITO_CLIENT_ID=<UserPoolClientId> \
NOTIFICATION_TOPIC_ARN=<NotificationTopicArn> UPLOAD_BUCKET=<UploadsBucketName> AUDIT_ANCHOR_BUCKET=<AuditAnchorBucketName> \
SECRETS_PARAMETER_PREFIX=/gatekeeper/dev APP_ORIGIN=https://gatekeeper-dev.example.com \
npx tsx scripts/bootstrap-community.ts --name "Lakeview Residences" --address "14 Lakeshore Road, Bengaluru" \
  --timezone Asia/Kolkata --admin-email you@example.com --admin-name "Your Name" --phone "+91 90000 00000"
```

The script prints the community's **join code** (for resident self-registration). Cognito e-mails the administrator a temporary password.

### 5. Confirm e-mail delivery

- Cognito sends verification and invitation e-mails using its default sender, which has a low daily limit. For real use, configure Cognito to send through **Amazon SES** with a verified domain and request SES production access.
- Residents who enable e-mail notifications receive an **SNS subscription confirmation** e-mail and must click it before notifications arrive.
- **SMS:** new accounts are in the SNS SMS sandbox (verified destination numbers only). Many countries require sender registration — in India, DLT entity and template registration. Set an SMS monthly spend limit in SNS before enabling `smsEnabled`.

### 6. Host the web tier

The Next.js app is the backend-for-frontend and needs a Node runtime (it keeps tokens in httpOnly cookies). Options:

- **AWS Amplify Hosting** (supports Next.js SSR): connect the repository, set the build command `npm run build`, and add the environment variables below.
- Any Node host or container platform: `npm ci && npm run build && npm start`.

Web-tier environment variables:

```
GATEKEEPER_MODE=AWS_PRODUCTION
AWS_REGION=<region>
COGNITO_USER_POOL_ID=<UserPoolId>
COGNITO_CLIENT_ID=<UserPoolClientId>
API_BASE_URL=<ApiUrl>
TRUSTED_PROXY_COUNT=1        # proxies in front of the app that append to X-Forwarded-For (see .env.example)
```

Run the web tier on **Node 22**. Mode-dependent UI is decided per request, so the same build artefact is safe in any environment.

The web tier needs **no AWS credentials** — it calls Cognito's public user-pool APIs and the API Gateway endpoint. Use the same HTTPS origin you passed as `appOrigin`.

### 7. Smoke test

Sign in as the administrator, create a building, apartment and guard, invite a resident, then run the visitor journey from the README with real accounts. Check CloudWatch logs for `api.unhandled` entries.

## Updating

`npx cdk diff …` then `npx cdk deploy …` with the same context. Lambda code is re-bundled from `src/` automatically.

## Destroying development resources

```bash
cd infrastructure
npx cdk destroy -c stage=dev -c appOrigin=https://gatekeeper-dev.example.com
```

For `dev`, the main table, uploads bucket and log groups are deleted (the bucket is emptied automatically). **The audit table and the audit-anchor bucket are retained by design**; anchor objects stay under Object Lock for 400 days and can only be removed early by a principal with `s3:BypassGovernanceRetention` (no application role has it). The audit table — delete it manually in the DynamoDB console if you really want it gone. Also delete the SSM parameters (`aws ssm delete-parameters --names /gatekeeper/dev/qr-token-pepper /gatekeeper/dev/encryption-key`) and any Amplify app. `prod` resources are retained and deletion-protected.

## Cost controls

- Create an **AWS Budget** (e.g. $5/month) with e-mail alerts before deploying.
- Keep `smsEnabled` off unless needed; set an SNS SMS spend limit.
- API Gateway throttling (50 rps, burst 100) caps runaway clients; adjust in the stack.
- Log retention is 30 days; reduce if logs grow.
- On-demand DynamoDB means zero cost at zero traffic; switch to provisioned capacity only with steady, predictable load.

## Monitoring

- CloudWatch alarms: API 5xx > 5 in 5 min, Lambda errors > 3 in 5 min (core, security, jobs) → alarm topic. A job that fails for any community now fails the invocation (after processing the others), so the jobs alarm fires and EventBridge retries.
- Structured JSON logs (`level`, `msg`, IDs). Useful queries: `api.unhandled`, `job.completed`, `notification.failed`, `audit.append_failed`.
- API Gateway access logs in `ApiAccessLogs`.
