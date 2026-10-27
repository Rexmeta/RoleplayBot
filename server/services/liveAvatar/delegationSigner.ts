import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { assertVerifiedAvatarIdentity, AvatarIdentityError, type VerifiedAvatarIdentity } from "./delegatedIdentity";

export const AVATAR_DELEGATION_AUDIENCE = "avatarrouter-api";
export const AVATAR_DELEGATION_CLIENT_ID = "roleplayx-avatarrouter";
const scopes = [
  "live-limits:read", "sessions:create", "sessions:read", "sessions:connect",
  "sessions:audio", "sessions:interrupt", "sessions:end", "assets:read", "assets:write",
] as const;
export type AvatarDelegationScope = typeof scopes[number];
export type PublicAvatarJwk = {
  kty: "RSA"; n: string; e: string; kid: string; alg: "RS256"; use: "sig"; key_ops: ["verify"];
};
export type AvatarDelegationStatus = {
  state: "unconfigured" | "invalid" | "configured";
  issuer?: string; jwksUrl?: string; kid?: string;
  audience: string; clientId: string; tokenLifetimeSeconds: 45;
};
type SignerInput = { issuer?: string; privateKeyPem?: string; previousPublicJwks?: string };
type Configuration = { privateKey: KeyObject; issuer: string; keys: PublicAvatarJwk[]; kid: string };
const privateParameters = ["d", "p", "q", "dp", "dq", "qi", "oth"];

/** No login JWT reuse. No token-minting HTTP endpoint. Keys stay server-only. */
export class AvatarDelegationSigner {
  private loaded = false;
  private config: Configuration | null = null;
  private configurationState: AvatarDelegationStatus["state"] = "unconfigured";

  constructor(private readonly input: () => SignerInput = () => ({
    issuer: process.env.AVATAR_ROUTER_DELEGATION_ISSUER,
    privateKeyPem: process.env.AVATAR_ROUTER_SIGNING_PRIVATE_KEY,
    previousPublicJwks: process.env.AVATAR_ROUTER_PREVIOUS_PUBLIC_JWKS,
  })) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const input = this.input();
      if (!input.issuer || !input.privateKeyPem) return;
      const issuerUrl = new URL(input.issuer);
      if (issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password ||
          issuerUrl.search || issuerUrl.hash || input.issuer.length > 2048 || input.privateKeyPem.length > 20_000) throw new Error();
      const privateKey = createPrivateKey(input.privateKeyPem);
      this.validateRsa(privateKey);
      const publicKey = createPublicKey(privateKey);
      const kid = `ar-${createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64url").slice(0, 32)}`;
      const jwk = publicKey.export({ format: "jwk" });
      const keys: PublicAvatarJwk[] = [this.publicJwk({ ...jwk, kid, alg: "RS256", use: "sig", key_ops: ["verify"] })];
      if (input.previousPublicJwks) {
        if (input.previousPublicJwks.length > 64 * 1024) throw new Error();
        const previous = JSON.parse(input.previousPublicJwks);
        if (!Array.isArray(previous?.keys) || previous.keys.length > 31) throw new Error();
        for (const key of previous.keys) {
          const accepted = this.publicJwk(key);
          if (keys.some(k => k.kid === accepted.kid)) throw new Error();
          keys.push(accepted);
        }
      }
      this.config = { privateKey, issuer: input.issuer, kid, keys };
      this.configurationState = "configured";
    } catch {
      // Never attach a PEM, parser error, input value or underlying cause.
      this.config = null;
      this.configurationState = "invalid";
    }
  }

  private validateRsa(key: KeyObject): void {
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (key.asymmetricKeyType !== "rsa" || bits < 2048 || bits > 8192) throw new Error();
  }

  private publicJwk(raw: Record<string, unknown>): PublicAvatarJwk {
    if (!raw || privateParameters.some(k => k in raw) ||
        raw.kty !== "RSA" || raw.alg !== "RS256" || raw.use !== "sig" ||
        typeof raw.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.kid) ||
        typeof raw.n !== "string" || !/^[A-Za-z0-9_-]{1,1500}$/.test(raw.n) ||
        typeof raw.e !== "string" || !/^[A-Za-z0-9_-]{1,16}$/.test(raw.e) ||
        !Array.isArray(raw.key_ops) || raw.key_ops.length !== 1 || raw.key_ops[0] !== "verify") throw new Error();
    const key = { kty: "RSA" as const, n: raw.n, e: raw.e, kid: raw.kid, alg: "RS256" as const, use: "sig" as const, key_ops: ["verify"] as ["verify"] };
    this.validateRsa(createPublicKey({ key, format: "jwk" }));
    return key;
  }

  status(): AvatarDelegationStatus {
    this.load();
    const common = { audience: AVATAR_DELEGATION_AUDIENCE, clientId: AVATAR_DELEGATION_CLIENT_ID, tokenLifetimeSeconds: 45 as const };
    return this.config ? {
      ...common, state: "configured", issuer: this.config.issuer, kid: this.config.kid,
      jwksUrl: new URL("/.well-known/jwks.json", this.config.issuer).toString(),
    } : { ...common, state: this.configurationState };
  }

  publicJwks(): { keys: PublicAvatarJwk[] } {
    this.load();
    if (!this.config) throw new AvatarIdentityError(`avatar_delegation_${this.configurationState}`, 503);
    // Copies prevent callers from mutating the cached trust material.
    return { keys: this.config.keys.map(key => ({ ...key, key_ops: ["verify"] })) };
  }

  mint(identity: VerifiedAvatarIdentity, scope: AvatarDelegationScope): string {
    assertVerifiedAvatarIdentity(identity);
    this.load();
    if (!this.config) throw new AvatarIdentityError(`avatar_delegation_${this.configurationState}`, 503);
    if (!(scopes as readonly string[]).includes(scope)) throw new AvatarIdentityError("avatar_delegation_scope_invalid", 403);
    const now = Math.floor(Date.now() / 1000);
    const header = { typ: "at+jwt", alg: "RS256", kid: this.config.kid };
    const claims = {
      iss: this.config.issuer, aud: AVATAR_DELEGATION_AUDIENCE, client_id: AVATAR_DELEGATION_CLIENT_ID,
      sub: identity.subject, tenant_id: identity.tenantId, scope,
      iat: now, exp: now + 45, jti: randomBytes(24).toString("base64url"),
    };
    const encoded = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    return `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), this.config.privateKey).toString("base64url")}`;
  }
}
