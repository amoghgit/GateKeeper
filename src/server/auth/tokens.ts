import { CognitoJwtVerifier } from "aws-jwt-verify";
import { jwtVerify, SignJWT } from "jose";
import { ROLES, type Role } from "@/shared/domain";
import { unauthorized } from "../errors";

export interface VerifiedIdentity {
  sub: string;
  groups: Role[];
}

export interface TokenVerifier {
  verify(accessToken: string): Promise<VerifiedIdentity>;
}

const toRoles = (groups: unknown): Role[] => (Array.isArray(groups) ? groups.filter((g): g is Role => (ROLES as readonly string[]).includes(g as string)) : []);

/** Production: verifies Cognito access tokens (signature via JWKS, issuer, client id, expiry, token_use). */
export class CognitoTokenVerifier implements TokenVerifier {
  private verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; clientId: string; tokenUse: "access" }>> | null = null;

  /**
   * Construction is lazy: aws-jwt-verify validates the pool ID eagerly, and the
   * Cognito trigger functions (which never verify tokens) cannot be given the
   * real pool ID without a CloudFormation dependency cycle.
   */
  constructor(
    private readonly userPoolId: string,
    private readonly clientId: string,
  ) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    this.verifier ??= CognitoJwtVerifier.create({ userPoolId: this.userPoolId, clientId: this.clientId, tokenUse: "access" });
    try {
      const payload = await this.verifier.verify(token);
      return { sub: payload.sub, groups: toRoles(payload["cognito:groups"]) };
    } catch {
      throw unauthorized("Your session has expired. Please sign in again.");
    }
  }
}

const DEMO_ISSUER = "gatekeeper-local-demo";
const DEMO_AUDIENCE = "gatekeeper";

/** LOCAL_DEMO: HS256 tokens that mirror the Cognito access-token claims we rely on. */
export class DemoTokenService implements TokenVerifier {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(sub: string, groups: Role[], use: "access" | "refresh", ttlSeconds: number): Promise<string> {
    return new SignJWT({ "cognito:groups": groups, token_use: use })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(sub)
      .setIssuer(DEMO_ISSUER)
      .setAudience(DEMO_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyUse(token: string, use: "access" | "refresh"): Promise<VerifiedIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: DEMO_ISSUER, audience: DEMO_AUDIENCE, algorithms: ["HS256"] });
      if (payload.token_use !== use || !payload.sub) throw new Error("wrong token use");
      return { sub: payload.sub, groups: toRoles(payload["cognito:groups"]) };
    } catch {
      throw unauthorized("Your session has expired. Please sign in again.");
    }
  }

  verify(token: string) {
    return this.verifyUse(token, "access");
  }
}
