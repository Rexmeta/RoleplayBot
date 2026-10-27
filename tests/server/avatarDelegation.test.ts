import { beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { AvatarDelegationSigner, type AvatarDelegationScope } from "../../server/services/liveAvatar/delegationSigner";
import { resolveAvatarIdentity, type AvatarIdentityStore, type VerifiedAvatarIdentity } from "../../server/services/liveAvatar/delegatedIdentity";

// Ephemeral fixture keys only. Never use an environment or production key.
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const issuer = "https://roleplayx.example.test";
const oldPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const oldJwk = { ...oldPair.publicKey.export({ format: "jwk" }), kid: "previous-key", alg: "RS256", use: "sig", key_ops: ["verify"] };
let store: AvatarIdentityStore;
let users: Record<string, any>;
let organizations: Record<string, any>;
let companies: Record<string, any>;
const signer = (overrides: Record<string, unknown> = {}) => new AvatarDelegationSigner(() => ({
  issuer, privateKeyPem: pem, ...overrides,
}));
beforeEach(() => {
  users = {
    a: { id: "a", isActive: true, organizationId: "org-one", companyId: "co" },
    b: { id: "b", isActive: true, organizationId: "org-one", companyId: "co" },
    c: { id: "c", isActive: true, organizationId: "org-two", companyId: "co" },
  };
  organizations = {
    "org-one": { id: "org-one", companyId: "co", isActive: true },
    "org-two": { id: "org-two", companyId: "co", isActive: true },
  };
  companies = { co: { id: "co", isActive: true } };
  store = {
    getUser: async id => users[id],
    getOrganization: async id => organizations[id],
    getCompany: async id => companies[id],
  };
});

describe("current RoleplayX membership delegation", () => {
  it("keeps subjects distinct while sharing only the verified organization tenant", async () => {
    const [a, b, c] = await Promise.all(["a", "b", "c"].map(id => resolveAvatarIdentity(store, id)));
    expect(a.subject).not.toBe(b.subject);
    expect(a.tenantId).toBe(b.tenantId);
    expect(a.tenantId).not.toBe(c.tenantId);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("uses separate personal tenants, never management assignment or browser tenant claims", async () => {
    users.a = { id: "a", isActive: true, assignedOrganizationId: "org-one" };
    users.b = { id: "b", isActive: true, assignedOrganizationId: "org-one" };
    const a = await resolveAvatarIdentity(store, "a");
    const b = await resolveAvatarIdentity(store, "b");
    expect(a.tenantId).toMatch(/^personal_/);
    expect(a.tenantId).not.toBe(b.tenantId);
  });

  it("re-resolves membership on the next operation, not from a cached login snapshot", async () => {
    const before = await resolveAvatarIdentity(store, "a");
    users.a.organizationId = "org-two";
    const after = await resolveAvatarIdentity(store, "a");
    expect(after.subject).toBe(before.subject);
    expect(after.tenantId).not.toBe(before.tenantId);
  });

  it.each(["missing", "inactive", "anonymized", "wrong-id"])("rejects an invalid account: %s", async condition => {
    if (condition === "missing") delete users.a;
    if (condition === "inactive") users.a.isActive = false;
    if (condition === "anonymized") users.a.isAnonymized = true;
    if (condition === "wrong-id") users.a.id = "b";
    await expect(resolveAvatarIdentity(store, "a")).rejects.toMatchObject({ status: 403 });
  });

  it.each(["missing-org", "inactive-org", "wrong-company", "inactive-company", "missing-company"])(
    "rejects invalid organization membership: %s", async condition => {
      if (condition === "missing-org") delete organizations["org-one"];
      if (condition === "inactive-org") organizations["org-one"].isActive = false;
      if (condition === "wrong-company") users.a.companyId = "other";
      if (condition === "inactive-company") companies.co.isActive = false;
      if (condition === "missing-company") delete companies.co;
      await expect(resolveAvatarIdentity(store, "a")).rejects.toMatchObject({ status: 403 });
    },
  );
});

describe("server-only RS256 delegation signer", () => {
  it("produces the documented at+jwt claims, 45-second lifetime and narrow scope", async () => {
    const signing = signer();
    const identity = await resolveAvatarIdentity(store, "a");
    const token = signing.mint(identity, "live-limits:read");
    const parsed = jwt.verify(token, pair.publicKey, { algorithms: ["RS256"], audience: "avatarrouter-api", issuer, complete: true }) as jwt.Jwt;
    expect(parsed.header).toMatchObject({ alg: "RS256", typ: "at+jwt", kid: signing.status().kid });
    const claims = parsed.payload as jwt.JwtPayload;
    expect(claims).toMatchObject({ iss: issuer, aud: "avatarrouter-api", client_id: "roleplayx-avatarrouter", sub: identity.subject, tenant_id: identity.tenantId, scope: "live-limits:read" });
    expect(claims.exp! - claims.iat!).toBe(45);
    expect(claims.jti).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(Object.keys(claims).sort()).toEqual(["iss", "aud", "client_id", "sub", "tenant_id", "scope", "iat", "exp", "jti"].sort());
    expect(JSON.stringify(signing.status())).not.toContain("PRIVATE");
  });

  it("mints a fresh jti for every operation", async () => {
    const signing = signer();
    const identity = await resolveAvatarIdentity(store, "a");
    const first = jwt.decode(signing.mint(identity, "sessions:read")) as jwt.JwtPayload;
    const next = jwt.decode(signing.mint(identity, "sessions:read")) as jwt.JwtPayload;
    expect(first.jti).not.toBe(next.jti);
  });

  it("publishes only verification-compatible public RSA parameters at a fixed URL", () => {
    const signing = signer();
    const published = signing.publicJwks();
    expect(Object.keys(published.keys[0]).sort()).toEqual(["kty", "n", "e", "kid", "alg", "use", "key_ops"].sort());
    expect(createPublicKey({ key: published.keys[0], format: "jwk" }).asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(signing.status().jwksUrl).toBe(`${issuer}/.well-known/jwks.json`);
    published.keys[0].kid = "tampered";
    expect(signing.publicJwks().keys[0].kid).not.toBe("tampered");
  });

  it("supports old public keys for rotation but signs only with the current private key", async () => {
    const signing = signer({ previousPublicJwks: JSON.stringify({ keys: [oldJwk] }) });
    expect(signing.publicJwks().keys.map(key => key.kid)).toContain("previous-key");
    const token = signing.mint(await resolveAvatarIdentity(store, "a"), "sessions:read");
    expect((jwt.decode(token, { complete: true })?.header.kid)).toBe(signing.status().kid);
    expect(() => jwt.verify(token, oldPair.publicKey, { algorithms: ["RS256"] })).toThrow();
  });

  it.each([
    { issuer: "http://issuer.test" }, { issuer: "https://user:password@issuer.test" },
    { issuer: "https://issuer.test/?query=1" }, { issuer: "https://issuer.test/#fragment" },
    { privateKeyPem: "ordinary-login-jwt-secret-not-an-rsa-key" },
    { previousPublicJwks: JSON.stringify({ keys: [{ ...oldJwk, d: "PRIVATE" }] }) },
    { previousPublicJwks: JSON.stringify({ keys: [{ ...oldJwk, alg: "HS256" }] }) },
    { previousPublicJwks: JSON.stringify({ keys: [{ ...oldJwk, key_ops: ["sign"] }] }) },
    { previousPublicJwks: JSON.stringify({ keys: [oldJwk, oldJwk] }) },
  ])("fails closed on invalid trust/key configuration", input => {
    const signing = signer(input);
    expect(signing.status().state).toBe("invalid");
    expect(() => signing.publicJwks()).toThrow("avatar_delegation_invalid");
  });

  it("rejects weak RSA and non-RSA signing keys", () => {
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    for (const keys of [weak, ec]) {
      expect(signer({ privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }).status().state).toBe("invalid");
    }
  });

  it("does not invent keys or fall back to the existing login signer", () => {
    const signing = new AvatarDelegationSigner(() => ({}));
    expect(signing.status().state).toBe("unconfigured");
    expect(() => signing.publicJwks()).toThrow("avatar_delegation_unconfigured");
  });

  it("rejects browser-shaped identity objects and unrecognized scopes", async () => {
    const signing = signer();
    expect(() => signing.mint({ subject: "a", tenantId: "b" } as VerifiedAvatarIdentity, "sessions:create")).toThrow("avatar_identity_not_verified");
    const identity = await resolveAvatarIdentity(store, "a");
    expect(() => signing.mint(identity, "sessions:*" as AvatarDelegationScope)).toThrow("avatar_delegation_scope_invalid");
  });
});
