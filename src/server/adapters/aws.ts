/**
 * AWS_PRODUCTION adapters: Cognito (identity admin), SNS (notifications),
 * S3 (uploads) and SSM Parameter Store (secrets).
 */
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PublishCommand, SNSClient, SubscribeCommand } from "@aws-sdk/client-sns";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Role } from "@/shared/domain";
import type { UploadTicket } from "@/shared/types";
import { ConfigurationError } from "../config";
import { ulid } from "../lib/ids";
import type { AuditAnchor, AuditAnchorStore, FileStorage, IdentityAdmin, Logger, Notifier, OutboundMessage, Secrets } from "../ports";

export class CognitoIdentityAdmin implements IdentityAdmin {
  constructor(
    private readonly userPoolId: string,
    private readonly client = new CognitoIdentityProviderClient({}),
  ) {}

  /**
   * Cognito generates the temporary password and e-mails the invitation
   * itself; the password is never visible to GateKeeper.
   */
  async createUser(input: { email: string; fullName: string; role: Role }) {
    const res = await this.client.send(
      new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: input.email,
        UserAttributes: [
          { Name: "email", Value: input.email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: input.fullName },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
    const sub = res.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
    if (!sub) throw new Error("Cognito did not return a subject for the new user");
    await this.client.send(new AdminAddUserToGroupCommand({ UserPoolId: this.userPoolId, Username: input.email, GroupName: input.role }));
    return { sub, temporaryPassword: null };
  }

  async setRole(_sub: string, email: string, role: Role, previous: Role | null) {
    if (previous) {
      await this.client.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: this.userPoolId, Username: email, GroupName: previous }));
    }
    await this.client.send(new AdminAddUserToGroupCommand({ UserPoolId: this.userPoolId, Username: email, GroupName: role }));
  }

  async setEnabled(_sub: string, email: string, enabled: boolean) {
    const Command = enabled ? AdminEnableUserCommand : AdminDisableUserCommand;
    await this.client.send(new Command({ UserPoolId: this.userPoolId, Username: email }));
  }
}

/**
 * One SNS topic; each user's e-mail endpoint is subscribed with a filter policy
 * on `userId`, so a publish reaches exactly one person. SMS is sent only when
 * explicitly enabled (it is billed per message and region-restricted).
 */
export class SnsNotifier implements Notifier {
  constructor(
    private readonly topicArn: string,
    private readonly smsEnabled: boolean,
    private readonly logger: Logger,
    private readonly client = new SNSClient({}),
  ) {}

  async send(m: OutboundMessage) {
    if (m.channels.email) {
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Subject: m.subject.slice(0, 99),
          Message: `${m.body}\n\n— GateKeeper`,
          MessageAttributes: { userId: { DataType: "String", StringValue: m.userId } },
        }),
      );
    }
    if (m.channels.sms) {
      if (!this.smsEnabled) {
        this.logger.info("sns.sms_skipped_disabled", { userId: m.userId });
        return;
      }
      const phone = m.phone.replace(/[^\d+]/g, "");
      if (!/^\+\d{8,15}$/.test(phone)) {
        this.logger.warn("sns.sms_invalid_number", { userId: m.userId });
        return;
      }
      await this.client.send(
        new PublishCommand({
          PhoneNumber: phone,
          Message: `GateKeeper: ${m.body}`.slice(0, 300),
          MessageAttributes: { "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" } },
        }),
      );
    }
  }

  async subscribeEmail(userId: string, email: string) {
    // The recipient must click the AWS confirmation e-mail before deliveries start.
    await this.client.send(
      new SubscribeCommand({
        TopicArn: this.topicArn,
        Protocol: "email",
        Endpoint: email,
        Attributes: { FilterPolicy: JSON.stringify({ userId: [userId] }) },
      }),
    );
  }
}

export class S3FileStorage implements FileStorage {
  constructor(
    private readonly bucket: string,
    private readonly client = new S3Client({}),
  ) {}

  /** Presigned PUT bound to an exact content type and length; the bucket blocks all public access. */
  async createUploadTicket(input: { communityId: string; contentType: string; size: number }): Promise<UploadTicket> {
    const ext = input.contentType === "image/png" ? "png" : input.contentType === "image/webp" ? "webp" : "jpg";
    const objectKey = `uploads/${input.communityId}/${ulid()}.${ext}`;
    const expiresIn = 300;
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.size,
        // Bucket default encryption (SSE-S3) applies; not signing an SSE header
        // avoids a header the browser would otherwise have to echo exactly.
      }),
      { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    return {
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      objectKey,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }
}

/**
 * Secrets come from SSM Parameter Store SecureStrings (standard tier — no
 * per-secret monthly fee), created once by the operator; see DEPLOYMENT.md.
 */
export async function loadSecretsFromSsm(prefix: string, client = new SSMClient({})): Promise<Secrets> {
  const names = [`${prefix}/qr-token-pepper`, `${prefix}/encryption-key`];
  const res = await client.send(new GetParametersCommand({ Names: names, WithDecryption: true }));
  const value = (name: string) => res.Parameters?.find((p) => p.Name === name)?.Value;
  const qrPepper = value(names[0]!);
  const encryptionKey = value(names[1]!);
  if (!qrPepper || !encryptionKey || qrPepper.length < 32 || encryptionKey.length < 32) {
    throw new ConfigurationError(`SSM parameters under ${prefix} are missing or shorter than 32 characters`);
  }
  return { qrPepper, encryptionKey };
}

/**
 * Audit-chain checkpoints in an S3 bucket with Object Lock (governance mode).
 * - Objects are created with If-None-Match so the app never replaces one.
 * - Locked versions cannot be deleted by application roles; an overwrite only
 *   adds a new version, and `list` reads every version so conflicts surface.
 */
export class S3AuditAnchorStore implements AuditAnchorStore {
  constructor(
    private readonly bucket: string,
    private readonly client = new S3Client({}),
  ) {}

  private key(a: { communityId: string; seq: number }) {
    return `anchors/${a.communityId}/${String(a.seq).padStart(12, "0")}.json`;
  }

  async put(anchor: AuditAnchor) {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: this.key(anchor), Body: JSON.stringify(anchor), ContentType: "application/json", IfNoneMatch: "*" }),
      );
    } catch (err) {
      // 412: this sequence number is already anchored — nothing to do.
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw err;
    }
  }

  async list(communityId: string): Promise<AuditAnchor[]> {
    const out: AuditAnchor[] = [];
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: `anchors/${communityId}/`, KeyMarker: keyMarker, VersionIdMarker: versionMarker }),
      );
      for (const v of page.Versions ?? []) {
        const obj = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: v.Key, VersionId: v.VersionId }));
        out.push(JSON.parse(await obj.Body!.transformToString()) as AuditAnchor);
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (keyMarker);
    return out;
  }
}
