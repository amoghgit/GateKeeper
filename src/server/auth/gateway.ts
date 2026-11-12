/**
 * Sign-in flows used by the Next.js backend-for-frontend (/api/auth/*).
 * CognitoAuthGateway calls the Cognito user-pool APIs; DemoAuthGateway is a
 * local stand-in with the same observable behaviour (verification codes,
 * forced password change, refresh tokens) for LOCAL_DEMO.
 */
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomInt, randomUUID } from "node:crypto";
import type { RegisterInput } from "@/shared/schemas";
import { AppError, badRequest, unauthorized } from "../errors";
import { hashPassword, verifyPassword } from "../lib/crypto";
import type { DemoCredentialStore, DemoOutbox } from "../adapters/demo";
import type { UserService } from "../services/user-service";
import type { DemoTokenService } from "./tokens";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

export type LoginResult = { kind: "ok"; tokens: AuthTokens } | { kind: "newPasswordRequired"; session: string };

export interface AuthGateway {
  login(email: string, password: string): Promise<LoginResult>;
  completeNewPassword(email: string, session: string, newPassword: string): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  signUp(input: RegisterInput): Promise<void>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendCode(email: string): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void>;
  logout(accessToken: string): Promise<void>;
}

const invalidLogin = () => new AppError(401, "INVALID_CREDENTIALS", "Incorrect e-mail or password.");
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 7 * 24 * 60 * 60;

export class DemoAuthGateway implements AuthGateway {
  constructor(
    private readonly creds: DemoCredentialStore,
    private readonly tokens: DemoTokenService,
    private readonly outbox: DemoOutbox,
    private readonly users: UserService,
  ) {}

  private async issue(sub: string, groups: string[]): Promise<AuthTokens> {
    const g = groups as Parameters<DemoTokenService["issue"]>[1];
    return {
      accessToken: await this.tokens.issue(sub, g, "access", ACCESS_TTL),
      refreshToken: await this.tokens.issue(sub, g, "refresh", REFRESH_TTL),
      expiresAt: Date.now() + ACCESS_TTL * 1000,
    };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const c = await this.creds.get(email);
    // Always run the hash comparison to keep timing uniform for unknown users.
    const ok = await verifyPassword(password, c?.passwordHash ?? "scrypt.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    if (!c || !ok) throw invalidLogin();
    if (!c.confirmed) throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your e-mail address before signing in.");
    if (!c.enabled) throw new AppError(403, "ACCOUNT_DISABLED", "This account has been deactivated. Contact your administrator.");
    if (c.mustChangePassword) {
      const session = await this.tokens.issue(c.sub, [], "refresh", 600);
      return { kind: "newPasswordRequired", session };
    }
    return { kind: "ok", tokens: await this.issue(c.sub, c.groups) };
  }

  async completeNewPassword(email: string, session: string, newPassword: string) {
    const c = await this.creds.get(email);
    const identity = await this.tokens.verifyUse(session, "refresh");
    if (!c || identity.sub !== c.sub || !c.mustChangePassword) throw unauthorized("This sign-in session has expired.");
    await this.creds.patch(email, { passwordHash: await hashPassword(newPassword), mustChangePassword: false });
    return this.issue(c.sub, c.groups);
  }

  async refresh(refreshToken: string) {
    const identity = await this.tokens.verifyUse(refreshToken, "refresh");
    // Re-read groups/enabled so role changes and deactivations apply on refresh.
    const res = await this.findBySub(identity.sub);
    if (!res || !res.enabled) throw unauthorized();
    const tokens = await this.issue(res.sub, res.groups);
    return { ...tokens, refreshToken };
  }

  private async findBySub(sub: string) {
    const user = await this.users.users.getBySub(sub);
    return user ? this.creds.get(user.email) : null;
  }

  private async sendCode(email: string, purpose: "VERIFY" | "RESET") {
    const code = String(randomInt(100000, 1000000));
    await this.creds.patch(email, { pendingCode: code, pendingCodePurpose: purpose, pendingCodeExpires: Date.now() + 15 * 60_000 });
    await this.outbox.push({
      channel: "AUTH",
      to: email,
      subject: purpose === "VERIFY" ? "Verify your GateKeeper e-mail" : "Reset your GateKeeper password",
      body: `Your verification code is ${code}. It expires in 15 minutes.`,
    });
  }

  private async consumeCode(email: string, code: string, purpose: "VERIFY" | "RESET") {
    const c = await this.creds.get(email);
    if (!c || c.pendingCodePurpose !== purpose || c.pendingCode !== code || (c.pendingCodeExpires ?? 0) < Date.now()) {
      throw badRequest("That code is invalid or has expired.", { code: ["Invalid or expired code"] });
    }
    await this.creds.patch(email, { pendingCode: null, pendingCodePurpose: null, pendingCodeExpires: null });
    return c;
  }

  async signUp(input: RegisterInput) {
    if (await this.creds.get(input.email)) {
      throw new AppError(409, "EMAIL_TAKEN", "An account with this e-mail already exists.");
    }
    await this.creds.create({
      email: input.email,
      sub: randomUUID(),
      passwordHash: await hashPassword(input.password),
      groups: [],
      confirmed: false,
      mustChangePassword: false,
      enabled: true,
      pendingCode: null,
      pendingCodePurpose: null,
      pendingCodeExpires: null,
      signupProfile: { fullName: input.fullName, phone: input.phone, joinCode: input.joinCode, unitNumber: input.unitNumber },
    });
    await this.sendCode(input.email, "VERIFY");
  }

  /** Mirrors Cognito's post-confirmation trigger: the PENDING profile is created on verification. */
  async confirmSignUp(email: string, code: string) {
    const c = await this.consumeCode(email, code, "VERIFY");
    const p = c.signupProfile;
    if (!p) throw badRequest("Registration details are missing.");
    await this.users.registerPending({
      sub: c.sub,
      email,
      fullName: p.fullName!,
      phone: p.phone!,
      joinCode: p.joinCode!,
      unitNumber: p.unitNumber!,
    });
    await this.creds.patch(email, { confirmed: true, signupProfile: null });
  }

  async resendCode(email: string) {
    const c = await this.creds.get(email);
    if (c && !c.confirmed) await this.sendCode(email, "VERIFY");
  }

  async forgotPassword(email: string) {
    // Respond identically whether or not the account exists (no user enumeration).
    const c = await this.creds.get(email);
    if (c?.confirmed && c.enabled) await this.sendCode(email, "RESET");
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string) {
    await this.consumeCode(email, code, "RESET");
    await this.creds.patch(email, { passwordHash: await hashPassword(newPassword), mustChangePassword: false });
  }

  async logout() {
    // Demo tokens are stateless; the cookie is cleared by the caller.
  }
}

export class CognitoAuthGateway implements AuthGateway {
  constructor(
    private readonly clientId: string,
    private readonly client = new CognitoIdentityProviderClient({}),
  ) {}

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw mapCognitoError(err);
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const res = await this.call(() =>
      this.client.send(
        new InitiateAuthCommand({ ClientId: this.clientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password } }),
      ),
    );
    if (res.ChallengeName === "NEW_PASSWORD_REQUIRED" && res.Session) return { kind: "newPasswordRequired", session: res.Session };
    const r = res.AuthenticationResult;
    if (!r?.AccessToken) throw invalidLogin();
    return { kind: "ok", tokens: { accessToken: r.AccessToken, refreshToken: r.RefreshToken ?? null, expiresAt: Date.now() + (r.ExpiresIn ?? 3600) * 1000 } };
  }

  async completeNewPassword(email: string, session: string, newPassword: string) {
    const res = await this.call(() =>
      this.client.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.clientId,
          ChallengeName: "NEW_PASSWORD_REQUIRED",
          Session: session,
          ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
        }),
      ),
    );
    const r = res.AuthenticationResult;
    if (!r?.AccessToken) throw unauthorized("This sign-in session has expired.");
    return { accessToken: r.AccessToken, refreshToken: r.RefreshToken ?? null, expiresAt: Date.now() + (r.ExpiresIn ?? 3600) * 1000 };
  }

  async refresh(refreshToken: string) {
    const res = await this.call(() =>
      this.client.send(new InitiateAuthCommand({ ClientId: this.clientId, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: refreshToken } })),
    );
    const r = res.AuthenticationResult;
    if (!r?.AccessToken) throw unauthorized();
    return { accessToken: r.AccessToken, refreshToken: r.RefreshToken ?? refreshToken, expiresAt: Date.now() + (r.ExpiresIn ?? 3600) * 1000 };
  }

  async signUp(input: RegisterInput) {
    await this.call(() =>
      this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: input.email,
          Password: input.password,
          UserAttributes: [
            { Name: "email", Value: input.email },
            { Name: "name", Value: input.fullName },
            { Name: "custom:phone", Value: input.phone },
            { Name: "custom:join_code", Value: input.joinCode },
            { Name: "custom:unit", Value: input.unitNumber },
          ],
        }),
      ),
    );
  }

  async confirmSignUp(email: string, code: string) {
    await this.call(() => this.client.send(new ConfirmSignUpCommand({ ClientId: this.clientId, Username: email, ConfirmationCode: code })));
  }

  async resendCode(email: string) {
    await this.call(() => this.client.send(new ResendConfirmationCodeCommand({ ClientId: this.clientId, Username: email })));
  }

  async forgotPassword(email: string) {
    try {
      await this.client.send(new ForgotPasswordCommand({ ClientId: this.clientId, Username: email }));
    } catch (err) {
      // Swallow "user not found" so responses cannot be used to enumerate accounts.
      if ((err as Error).name !== "UserNotFoundException") throw mapCognitoError(err);
    }
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string) {
    await this.call(() =>
      this.client.send(new ConfirmForgotPasswordCommand({ ClientId: this.clientId, Username: email, ConfirmationCode: code, Password: newPassword })),
    );
  }

  async logout(accessToken: string) {
    // Revokes refresh tokens server-side.
    await this.client.send(new GlobalSignOutCommand({ AccessToken: accessToken })).catch(() => undefined);
  }
}

export function mapCognitoError(err: unknown): AppError {
  const name = (err as Error).name;
  switch (name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return invalidLogin();
    case "UserNotConfirmedException":
      return new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your e-mail address before signing in.");
    case "UsernameExistsException":
      return new AppError(409, "EMAIL_TAKEN", "An account with this e-mail already exists.");
    case "CodeMismatchException":
    case "ExpiredCodeException":
      return badRequest("That code is invalid or has expired.", { code: ["Invalid or expired code"] });
    case "InvalidPasswordException":
      return badRequest("Password does not meet the policy.", { password: ["Password does not meet the policy"] });
    case "UserLambdaValidationException":
      // Raised when the pre-sign-up trigger rejects the community code.
      return badRequest("Unknown community code.", { joinCode: ["Unknown community code"] });
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return new AppError(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.");
    default:
      return new AppError(502, "IDENTITY_PROVIDER_ERROR", "The sign-in service is unavailable. Please try again.");
  }
}
