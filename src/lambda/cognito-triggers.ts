/**
 * Cognito user-pool triggers.
 *  - Pre sign-up: rejects self-registrations with an unknown community code.
 *  - Post confirmation: creates the PENDING GateKeeper profile once the e-mail
 *    is verified. Admin-created users (AdminCreateUser) skip this trigger's
 *    registration path because the admin API already provisions them.
 */
import type { PostConfirmationTriggerEvent, PreSignUpTriggerEvent } from "aws-lambda";
import { CommunityRepo } from "@/server/repositories/community-repo";
import { getRuntime } from "@/server/runtime";

export async function preSignUp(event: PreSignUpTriggerEvent) {
  if (event.triggerSource === "PreSignUp_AdminCreateUser") return event;
  const runtime = await getRuntime();
  const code = (event.request.userAttributes["custom:join_code"] ?? "").toUpperCase();
  const community = code ? await new CommunityRepo(runtime.deps.table).getByJoinCode(code) : null;
  if (!community) throw new Error("Unknown community code");
  return event;
}

export async function postConfirmation(event: PostConfirmationTriggerEvent) {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") return event;
  const runtime = await getRuntime();
  const a = event.request.userAttributes;
  const existing = await runtime.services.users.users.getBySub(a.sub!);
  if (!existing) {
    await runtime.services.users.registerPending({
      sub: a.sub!,
      email: a.email!,
      fullName: a.name ?? a.email!,
      phone: a["custom:phone"] ?? "",
      joinCode: a["custom:join_code"] ?? "",
      unitNumber: a["custom:unit"] ?? "",
    });
  }
  return event;
}
