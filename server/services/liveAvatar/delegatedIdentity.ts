import { createHash } from "node:crypto";

const verifiedIdentity = Symbol("server-verified-avatar-identity");
export type VerifiedAvatarIdentity = Readonly<{
  subject: string;
  tenantId: string;
  [verifiedIdentity]: true;
}>;

/** Only current membership records, not category/operator management assignments. */
export interface AvatarIdentityStore {
  getUser(id: string): Promise<{
    id: string; isActive: boolean; isAnonymized?: boolean | null;
    organizationId?: string | null; companyId?: string | null;
  } | undefined>;
  getOrganization(id: string): Promise<{ id: string; companyId: string; isActive: boolean } | undefined>;
  getCompany(id: string): Promise<{ id: string; isActive: boolean } | undefined>;
}

export class AvatarIdentityError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const opaque = (namespace: string, id: string) =>
  createHash("sha256").update(`roleplayx:${namespace}:${id}`).digest("base64url");

export async function resolveAvatarIdentity(store: AvatarIdentityStore, authenticatedUserId: string): Promise<VerifiedAvatarIdentity> {
  const user = await store.getUser(authenticatedUserId);
  if (!user || user.id !== authenticatedUserId || !user.isActive || user.isAnonymized) {
    throw new AvatarIdentityError("avatar_identity_account_inactive", 403);
  }
  let tenantId: string;
  if (user.organizationId) {
    const organization = await store.getOrganization(user.organizationId);
    if (!organization?.isActive || organization.id !== user.organizationId ||
        (user.companyId && user.companyId !== organization.companyId)) {
      throw new AvatarIdentityError("avatar_identity_membership_invalid", 403);
    }
    const company = await store.getCompany(organization.companyId);
    if (!company?.isActive || company.id !== organization.companyId) {
      throw new AvatarIdentityError("avatar_identity_membership_invalid", 403);
    }
    tenantId = `org_${opaque("organization", organization.id)}`;
  } else {
    // A company-only legacy account is not proof of membership in an organization.
    // Keep personal access isolated instead of inventing organization membership.
    if (user.companyId) {
      const company = await store.getCompany(user.companyId);
      if (!company?.isActive || company.id !== user.companyId) {
        throw new AvatarIdentityError("avatar_identity_membership_invalid", 403);
      }
    }
    tenantId = `personal_${opaque("personal", user.id)}`;
  }
  return Object.freeze({ subject: `user_${opaque("user", user.id)}`, tenantId, [verifiedIdentity]: true as const });
}

export function assertVerifiedAvatarIdentity(identity: VerifiedAvatarIdentity): void {
  if (identity?.[verifiedIdentity] !== true) throw new AvatarIdentityError("avatar_identity_not_verified", 403);
}
