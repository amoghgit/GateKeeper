/**
 * One-time production bootstrap: creates a community and its first administrator.
 * Administrators cannot be created through the API (prevents role escalation),
 * so the first one is provisioned by an operator with AWS credentials.
 *
 * Usage (after `cdk deploy` and creating the SSM secrets):
 *   GATEKEEPER_MODE=AWS_PRODUCTION AWS_REGION=... TABLE_NAME=... AUDIT_TABLE_NAME=... \
 *   COGNITO_USER_POOL_ID=... COGNITO_CLIENT_ID=... NOTIFICATION_TOPIC_ARN=... UPLOAD_BUCKET=... AUDIT_ANCHOR_BUCKET=... \
 *   SECRETS_PARAMETER_PREFIX=/gatekeeper/dev APP_ORIGIN=https://... \
 *   npx tsx scripts/bootstrap-community.ts --name "Lakeview Residences" --address "..." \
 *     --timezone Asia/Kolkata --admin-email admin@example.com --admin-name "Priya Raman" --phone "+91 ..."
 */
import { parseArgs } from "node:util";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/shared/domain";
import { systemActor } from "@/server/auth/actor";
import { loadConfig } from "@/server/config";
import { newId, joinCode } from "@/server/lib/ids";
import { CommunityRepo } from "@/server/repositories/community-repo";
import { UserRepo } from "@/server/repositories/user-repo";
import { buildAwsRuntime } from "@/server/runtime";

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      address: { type: "string" },
      timezone: { type: "string", default: "Asia/Kolkata" },
      "admin-email": { type: "string" },
      "admin-name": { type: "string" },
      phone: { type: "string" },
    },
  });
  const required = ["name", "address", "admin-email", "admin-name", "phone"] as const;
  for (const k of required) if (!values[k]) throw new Error(`--${k} is required`);
  const config = loadConfig();
  if (config.mode !== "AWS_PRODUCTION") throw new Error("Run with GATEKEEPER_MODE=AWS_PRODUCTION (demo mode seeds itself).");

  const runtime = await buildAwsRuntime(config);
  const now = new Date().toISOString();
  const communityId = newId("cmty");
  const code = joinCode();
  await runtime.deps.table.transact([
    new CommunityRepo(runtime.deps.table).putOp({
      communityId,
      name: values.name!,
      address: values.address!,
      contactEmail: values["admin-email"]!,
      contactPhone: values.phone!,
      timezone: values.timezone!,
      joinCode: code,
      settings: { entryGraceMinutes: 60, overdueAfterMinutes: 60, walkInsRequireApproval: true, remindersEnabled: true },
      createdAt: now,
    }),
  ]);

  const { sub } = await runtime.deps.identity.createUser({ email: values["admin-email"]!, fullName: values["admin-name"]!, role: "ADMIN" });
  const users = new UserRepo(runtime.deps.table);
  const userId = newId("usr");
  await runtime.deps.table.transact(
    users.createOps({
      userId,
      communityId,
      cognitoSub: sub,
      fullName: values["admin-name"]!,
      email: values["admin-email"]!.toLowerCase(),
      phone: values.phone!,
      role: "ADMIN",
      status: "ACTIVE",
      apartmentId: null,
      apartmentLabel: null,
      shift: null,
      emergencyContact: null,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES,
      requestedUnit: null,
      createdAt: now,
      updatedAt: now,
    }),
  );
  await runtime.services.audit.record(systemActor(communityId), "COMMUNITY_CREATED", "Community", communityId, { name: values.name! });
  await runtime.services.audit.record(systemActor(communityId), "ADMIN_CREATED", "User", userId, { role: "ADMIN" });
  console.log(
    JSON.stringify({ communityId, joinCode: code, adminUserId: userId, note: "Cognito has e-mailed the administrator a temporary password." }, null, 2),
  );
}

main().catch((err) => {
  console.error(`Bootstrap failed: ${(err as Error).message}`);
  process.exit(1);
});
