import { and, desc, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { db } from "../../storage/db";
import { cultureProfiles, cultureProfileVersions } from "../../../shared/schema/cultureMap";
import { cultureProfileInputSchema, cultureSelectionSchema, cultureSnapshotSchema, type CultureProfileInput } from "../../../shared/cultureMap";

export type CultureUser = { id: string; role: string };
export class CultureError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export function canReadCulture(user: CultureUser, row: { ownerId: string; content: CultureProfileInput }) {
  return user.role === "admin" || row.ownerId === user.id || row.content.visibility === "shared";
}
export function canWriteCulture(user: CultureUser, row: { ownerId: string }) {
  return user.role === "admin" || row.ownerId === user.id;
}
function parseContent(input: unknown, user: CultureUser) {
  const parsed = cultureProfileInputSchema.safeParse(input);
  if (!parsed.success) throw new CultureError("문화 프로필 입력을 확인해 주세요.");
  if (parsed.data.visibility === "shared" && user.role !== "admin")
    throw new CultureError("공유 프로필은 관리자만 등록할 수 있습니다.", 403);
  return parsed.data;
}
function present(row: typeof cultureProfiles.$inferSelect) {
  return { ...row.content, id: row.id, ownerId: row.ownerId, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function accessible(id: string, user: CultureUser, connection: any = db) {
  const [row] = await connection.select().from(cultureProfiles).where(eq(cultureProfiles.id, id));
  if (!row || row.isDeleted || !canReadCulture(user, row)) throw new CultureError("문화 프로필을 찾을 수 없습니다.", 404);
  return row as typeof cultureProfiles.$inferSelect;
}
export async function listCultureProfiles(user: CultureUser) {
  const rows = await db.select().from(cultureProfiles).where(eq(cultureProfiles.isDeleted, false))
    .orderBy(desc(cultureProfiles.updatedAt));
  return rows.filter(row => canReadCulture(user, row)).map(present);
}
export async function getCultureProfile(id: string, user: CultureUser) {
  return present(await accessible(id, user));
}
export async function createCultureProfile(input: unknown, user: CultureUser) {
  const content = parseContent(input, user);
  return db.transaction(async tx => {
    const [row] = await tx.insert(cultureProfiles).values({ ownerId: user.id, content }).returning();
    await tx.insert(cultureProfileVersions).values({ profileId: row.id, version: 1, content, createdBy: user.id });
    return present(row);
  });
}
export async function updateCultureProfile(id: string, input: unknown, expectedVersion: number, user: CultureUser) {
  const content = parseContent(input, user);
  return db.transaction(async tx => {
    const row = await accessible(id, user, tx);
    if (!canWriteCulture(user, row)) throw new CultureError("이 프로필을 수정할 권한이 없습니다.", 403);
    const [updated] = await tx.update(cultureProfiles).set({ content, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(cultureProfiles.id, id), eq(cultureProfiles.version, expectedVersion), eq(cultureProfiles.isDeleted, false))).returning();
    if (!updated) throw new CultureError("다른 변경이 있습니다. 새로고침 후 다시 저장해 주세요.", 409);
    await tx.insert(cultureProfileVersions).values({ profileId: id, version: updated.version, content, createdBy: user.id });
    return present(updated);
  });
}
export async function deleteCultureProfile(id: string, expectedVersion: number, user: CultureUser) {
  const row = await accessible(id, user);
  if (!canWriteCulture(user, row)) throw new CultureError("이 프로필을 삭제할 권한이 없습니다.", 403);
  const result = await db.update(cultureProfiles).set({ isDeleted: true, updatedAt: new Date() })
    .where(and(eq(cultureProfiles.id, id), eq(cultureProfiles.version, expectedVersion), eq(cultureProfiles.isDeleted, false))).returning();
  if (!result.length) throw new CultureError("다른 변경이 있습니다. 새로고침 후 다시 시도해 주세요.", 409);
}
export async function listCultureVersions(id: string, user: CultureUser) {
  await accessible(id, user);
  return db.select({ version: cultureProfileVersions.version, content: cultureProfileVersions.content, createdAt: cultureProfileVersions.createdAt })
    .from(cultureProfileVersions).where(eq(cultureProfileVersions.profileId, id)).orderBy(desc(cultureProfileVersions.version));
}
export async function duplicateCultureProfile(id: string, user: CultureUser) {
  const original = await accessible(id, user);
  return createCultureProfile({ ...original.content, name: `${original.content.name.slice(0, 140)} (복제)`, visibility: "private" }, user);
}

/** Bind only versioned server content; never accept client-authored snapshots as authority. */
export async function bindActorCultures(actors: any[], user: CultureUser, existingActors: any[] = []) {
  if (!Array.isArray(actors)) throw new CultureError("Actor 목록이 필요합니다.");
  const seen = new Set<string>();
  return Promise.all(actors.map(async actor => {
    if (!actor || typeof actor.id !== "string") throw new CultureError("Actor ID가 필요합니다.");
    if (seen.has(actor.id)) throw new CultureError("Actor ID는 중복될 수 없습니다.");
    seen.add(actor.id);
    if (actor.culture === undefined || actor.culture === null) return actor;
    if (actor.culture.enabled === false) return { ...actor, culture: { enabled: false } };
    const prior = existingActors.find(a => a.id === actor.id)?.culture;
    // An unchanged saved snapshot does not require live source access (or existence).
    if (prior && isDeepStrictEqual(prior, actor.culture) && cultureSnapshotSchema.safeParse(prior).success) return actor;
    const selection = cultureSelectionSchema.safeParse({
      enabled: actor.culture.enabled, profileId: actor.culture.profileId,
      profileVersion: actor.culture.profileVersion, intensity: actor.culture.intensity,
      overrides: actor.culture.overrides,
    });
    if (!selection.success) throw new CultureError("Actor 문화 설정을 확인해 주세요.");
    const chosen = selection.data;
    await accessible(chosen.profileId, user);
    const [version] = await db.select().from(cultureProfileVersions).where(and(
      eq(cultureProfileVersions.profileId, chosen.profileId), eq(cultureProfileVersions.version, chosen.profileVersion),
    ));
    if (!version) throw new CultureError("선택한 문화 프로필 버전이 없습니다.", 404);
    const { name, country, region, sources, dimensions } = version.content;
    const snapshot = cultureSnapshotSchema.parse({
      ...chosen, snapshotVersion: 1, name, country, region, sources,
      dimensions: { ...dimensions, ...chosen.overrides },
    });
    return { ...actor, culture: snapshot };
  }));
}
