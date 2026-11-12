import * as path from "node:path";
import {
  Aws,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Tags,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cwActions,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_kms as kms,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export interface GateKeeperStackProps extends StackProps {
  stage: "dev" | "prod";
  /** Origin of the Next.js web tier, e.g. https://gatekeeper.example.com — used for CORS. */
  appOrigin: string;
  /** Optional address for operational alarms. */
  alarmEmail?: string;
  /** SMS is billed per message — off unless explicitly enabled. */
  smsEnabled?: boolean;
}

const SRC = path.join(__dirname, "..", "..", "src");
const REPO_ROOT = path.join(__dirname, "..", "..");
const ROOT_TSCONFIG = path.join(REPO_ROOT, "tsconfig.json");

/**
 * GateKeeper serverless stack.
 * No EC2, RDS or NAT Gateway: everything scales to zero and is billed per use.
 */
export class GateKeeperStack extends Stack {
  constructor(scope: Construct, id: string, props: GateKeeperStackProps) {
    super(scope, id, props);
    const prod = props.stage === "prod";
    const removalPolicy = prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    Tags.of(this).add("Project", "GateKeeper");
    Tags.of(this).add("Stage", props.stage);
    Tags.of(this).add("ManagedBy", "aws-cdk");

    // ─────────────────────────── Data ───────────────────────────
    const table = new dynamodb.TableV2(this, "MainTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: prod },
      deletionProtection: prod,
      removalPolicy,
      globalSecondaryIndexes: (["GSI1", "GSI2", "GSI3"] as const).map((name) => ({
        indexName: name,
        partitionKey: { name: `${name}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `${name}SK`, type: dynamodb.AttributeType.STRING },
      })),
    });

    // Append-only audit trail: application roles get PutItem/GetItem/Query only.
    const auditTable = new dynamodb.TableV2(this, "AuditTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: prod },
      deletionProtection: prod,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const uploads = new s3.Bucket(this, "UploadsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy,
      autoDeleteObjects: !prod,
      cors: [{ allowedOrigins: [props.appOrigin], allowedMethods: [s3.HttpMethods.PUT], allowedHeaders: ["Content-Type"], maxAge: 3000 }],
      lifecycleRules: [{ prefix: "uploads/", expiration: Duration.days(90) }, { abortIncompleteMultipartUploadAfter: Duration.days(1) }],
    });

    // Write-once checkpoints of the audit hash chain. Object Lock (governance)
    // keeps every version for 400 days; no application role may delete objects,
    // shorten retention or bypass governance mode.
    const auditAnchors = new s3.Bucket(this, "AuditAnchorBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.governance(Duration.days(400)),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ─────────────────────────── Messaging ───────────────────────────
    const notificationsTopic = new sns.Topic(this, "NotificationsTopic", {
      displayName: "GateKeeper notifications",
      masterKey: kms.Alias.fromAliasName(this, "SnsKey", "alias/aws/sns"),
    });
    const alarmTopic = new sns.Topic(this, "AlarmTopic", { displayName: "GateKeeper alarms" });
    if (props.alarmEmail) alarmTopic.addSubscription(new subs.EmailSubscription(props.alarmEmail));

    // ─────────────────────────── Identity ───────────────────────────
    const triggerFn = this.fn("CognitoTriggers", "lambda/cognito-triggers.ts", "postConfirmation", {});
    const preSignUpFn = this.fn("CognitoPreSignUp", "lambda/cognito-triggers.ts", "preSignUp", {});

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `gatekeeper-${props.stage}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true }, fullname: { required: true, mutable: true } },
      customAttributes: {
        phone: new cognito.StringAttribute({ minLen: 7, maxLen: 24, mutable: true }),
        join_code: new cognito.StringAttribute({ minLen: 6, maxLen: 10, mutable: false }),
        unit: new cognito.StringAttribute({ minLen: 1, maxLen: 20, mutable: true }),
      },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: "You've been invited to GateKeeper",
        emailBody:
          "Hello, your GateKeeper account is ready. Sign in with {username} and temporary password {####}. You'll choose a new password at first sign-in.",
      },
      lambdaTriggers: { preSignUp: preSignUpFn, postConfirmation: triggerFn },
      removalPolicy,
    });
    const client = userPool.addClient("WebClient", {
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });
    for (const [name, precedence] of [
      ["ADMIN", 0],
      ["SECURITY", 10],
      ["RESIDENT", 20],
    ] as const) {
      new cognito.CfnUserPoolGroup(this, `Group${name}`, { userPoolId: userPool.userPoolId, groupName: name, precedence });
    }

    // ─────────────────────────── Compute ───────────────────────────
    const env: Record<string, string> = {
      GATEKEEPER_MODE: "AWS_PRODUCTION",
      TABLE_NAME: table.tableName,
      AUDIT_TABLE_NAME: auditTable.tableName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: client.userPoolClientId,
      NOTIFICATION_TOPIC_ARN: notificationsTopic.topicArn,
      UPLOAD_BUCKET: uploads.bucketName,
      AUDIT_ANCHOR_BUCKET: auditAnchors.bucketName,
      SECRETS_PARAMETER_PREFIX: `/gatekeeper/${props.stage}`,
      APP_ORIGIN: props.appOrigin,
      SMS_ENABLED: String(Boolean(props.smsEnabled)),
    };
    // Cognito triggers cannot reference the pool that invokes them (circular dependency).
    // They only touch DynamoDB, so Cognito settings are informational placeholders here.
    const triggerEnv = { ...env, COGNITO_USER_POOL_ID: "not-used-by-triggers", COGNITO_CLIENT_ID: "not-used-by-triggers" };
    for (const f of [triggerFn, preSignUpFn]) for (const [k, v] of Object.entries(triggerEnv)) f.addEnvironment(k, v);

    const coreFn = this.fn("ApiCore", "lambda/api.ts", "handler", {
      ...env,
      ROUTE_PREFIXES: "/me,/visitors,/invitations,/notifications,/announcements,/resident",
    });
    const securityFn = this.fn("ApiSecurity", "lambda/api.ts", "handler", { ...env, ROUTE_PREFIXES: "/security,/uploads,/apartments" });
    const adminFn = this.fn("ApiAdmin", "lambda/api.ts", "handler", { ...env, ROUTE_PREFIXES: "/admin,/residents" });
    const jobsFn = this.fn("Jobs", "lambda/jobs.ts", "handler", env, Duration.minutes(5));
    const all = [coreFn, securityFn, adminFn, jobsFn, triggerFn, preSignUpFn];

    // ─────────────────────────── Least-privilege IAM ───────────────────────────
    const ssmArn = `arn:${Aws.PARTITION}:ssm:${Aws.REGION}:${Aws.ACCOUNT_ID}:parameter/gatekeeper/${props.stage}/*`;
    const mainTableArns = [table.tableArn, `${table.tableArn}/index/*`];
    // Exactly the item operations the app performs (transactions are authorised per item action).
    const mainReadWrite = [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:ConditionCheckItem",
    ];
    const apiAndJobs = [coreFn, securityFn, adminFn, jobsFn];
    for (const f of all) f.addToRolePolicy(new iam.PolicyStatement({ actions: ["ssm:GetParameters"], resources: [ssmArn] }));
    for (const f of [...apiAndJobs, triggerFn]) {
      f.addToRolePolicy(new iam.PolicyStatement({ actions: mainReadWrite, resources: mainTableArns }));
    }
    // The pre-sign-up trigger only looks up a community by join code.
    preSignUpFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["dynamodb:GetItem", "dynamodb:Query"], resources: mainTableArns }));
    for (const f of apiAndJobs) {
      f.addToRolePolicy(new iam.PolicyStatement({ actions: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query"], resources: [auditTable.tableArn] }));
    }
    // Defence in depth: explicit denies survive any future broad grant.
    for (const f of all) {
      f.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: ["dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem", "dynamodb:DeleteTable", "dynamodb:UpdateTable"],
          resources: [auditTable.tableArn],
        }),
      );
      f.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: [
            "s3:DeleteObject",
            "s3:DeleteObjectVersion",
            "s3:BypassGovernanceRetention",
            "s3:PutObjectRetention",
            "s3:PutObjectLegalHold",
            "s3:PutBucketObjectLockConfiguration",
            "s3:DeleteBucket",
          ],
          resources: [auditAnchors.bucketArn, auditAnchors.arnForObjects("*")],
        }),
      );
    }
    jobsFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [auditAnchors.arnForObjects("anchors/*")] }));
    adminFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:GetObjectVersion"], resources: [auditAnchors.arnForObjects("anchors/*")] }),
    );
    adminFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucketVersions"],
        resources: [auditAnchors.bucketArn],
        conditions: { StringLike: { "s3:prefix": ["anchors/*"] } },
      }),
    );
    for (const f of [...apiAndJobs, triggerFn]) notificationsTopic.grantPublish(f);
    coreFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["sns:Subscribe"], resources: [notificationsTopic.topicArn] }));
    if (props.smsEnabled) {
      // Direct-to-phone publishes have no topic ARN. NotResource on every SNS ARN
      // allows SMS while still forbidding publishing to any other topic.
      for (const f of apiAndJobs) {
        f.addToRolePolicy(new iam.PolicyStatement({ actions: ["sns:Publish"], notResources: [`arn:${Aws.PARTITION}:sns:*:*:*`] }));
      }
    }
    // Presigned uploads are signed with the security function's role, so it needs exactly PutObject.
    securityFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [uploads.arnForObjects("uploads/*")] }));
    const cognitoAdmin = new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:AdminEnableUser",
        "cognito-idp:AdminDisableUser",
      ],
      resources: [userPool.userPoolArn],
    });
    adminFn.addToRolePolicy(cognitoAdmin);
    jobsFn.addToRolePolicy(new iam.PolicyStatement({ actions: ["cognito-idp:AdminDisableUser"], resources: [userPool.userPoolArn] }));

    // ─────────────────────────── API Gateway (HTTP API) ───────────────────────────
    const accessLogs = new logs.LogGroup(this, "ApiAccessLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy });
    const api = new apigw.HttpApi(this, "HttpApi", {
      apiName: `gatekeeper-${props.stage}`,
      corsPreflight: {
        allowOrigins: [props.appOrigin],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PATCH, apigw.CorsHttpMethod.DELETE],
        allowHeaders: ["Authorization", "Content-Type"],
        maxAge: Duration.hours(1),
      },
      createDefaultStage: false,
    });
    const stage = new apigw.HttpStage(this, "DefaultStage", {
      httpApi: api,
      autoDeploy: true,
      throttle: { rateLimit: 50, burstLimit: 100 },
    });
    const cfnStage = stage.node.defaultChild as apigw.CfnStage;
    cfnStage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: "$context.requestId",
        ip: "$context.identity.sourceIp",
        method: "$context.httpMethod",
        path: "$context.path",
        status: "$context.status",
        latency: "$context.responseLatency",
      }),
    };
    // Defence in depth: API Gateway rejects bad tokens before Lambda; Lambda verifies again.
    const authorizer = new authorizers.HttpJwtAuthorizer("CognitoAuthorizer", `https://cognito-idp.${Aws.REGION}.amazonaws.com/${userPool.userPoolId}`, {
      jwtAudience: [client.userPoolClientId],
    });
    const route = (p: string, fn: lambda.IFunction, name: string) =>
      api.addRoutes({
        path: p,
        methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST, apigw.HttpMethod.PATCH, apigw.HttpMethod.DELETE],
        integration: new integrations.HttpLambdaIntegration(`${name}${p.replace(/\W/g, "")}`, fn),
        authorizer,
      });
    for (const p of ["/v1/security/{proxy+}", "/v1/uploads", "/v1/apartments"]) route(p, securityFn, "Security");
    for (const p of ["/v1/admin/{proxy+}", "/v1/residents", "/v1/residents/{proxy+}"]) route(p, adminFn, "Admin");
    route("/v1/{proxy+}", coreFn, "Core");

    // ─────────────────────────── Scheduled jobs (EventBridge) ───────────────────────────
    const schedules: [string, events.Schedule][] = [
      ["expire-invitations", events.Schedule.rate(Duration.minutes(15))],
      ["flag-overdue", events.Schedule.rate(Duration.minutes(15))],
      ["reminders", events.Schedule.rate(Duration.minutes(15))],
      ["daily-summary", events.Schedule.rate(Duration.hours(6))],
      ["cleanup", events.Schedule.cron({ minute: "30", hour: "21" })],
      ["audit-anchor", events.Schedule.cron({ minute: "45", hour: "*/6" })],
    ];
    for (const [job, schedule] of schedules) {
      new events.Rule(this, `Job-${job}`, {
        schedule,
        targets: [new targets.LambdaFunction(jobsFn, { event: events.RuleTargetInput.fromObject({ job }), retryAttempts: 2 })],
      });
    }

    // ─────────────────────────── Monitoring (CloudWatch) ───────────────────────────
    const alarmAction = new cwActions.SnsAction(alarmTopic);
    new cloudwatch.Alarm(this, "Api5xxAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5xx",
        dimensionsMap: { ApiId: api.apiId, Stage: stage.stageName },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "GateKeeper API is returning server errors",
    }).addAlarmAction(alarmAction);
    for (const [name, f] of [
      ["Core", coreFn],
      ["Security", securityFn],
      ["Jobs", jobsFn],
    ] as const) {
      new cloudwatch.Alarm(this, `${name}ErrorsAlarm`, {
        metric: f.metricErrors({ period: Duration.minutes(5) }),
        threshold: 3,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);
    }

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "AuditTableName", { value: auditTable.tableName });
    new CfnOutput(this, "UploadsBucketName", { value: uploads.bucketName });
    new CfnOutput(this, "NotificationTopicArn", { value: notificationsTopic.topicArn });
    new CfnOutput(this, "AuditAnchorBucketName", { value: auditAnchors.bucketName });
    new CfnOutput(this, "SecretsParameterPrefix", { value: `/gatekeeper/${props.stage}` });
  }

  private fn(id: string, entry: string, handler: string, environment: Record<string, string>, timeout = Duration.seconds(15)) {
    const logGroup = new logs.LogGroup(this, `${id}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    return new nodejs.NodejsFunction(this, id, {
      entry: path.join(SRC, entry),
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, "package-lock.json"),
      handler,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout,
      environment: { NODE_OPTIONS: "--enable-source-maps", ...environment },
      logGroup,
      tracing: lambda.Tracing.DISABLED,
      bundling: { minify: true, sourceMap: true, target: "node22", format: nodejs.OutputFormat.CJS, tsconfig: ROOT_TSCONFIG, externalModules: [] },
    });
  }
}
