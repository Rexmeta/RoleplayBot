import { and, eq } from "drizzle-orm";
import { db } from "../../storage/db";
import { cultureProfiles, cultureProfileVersions } from "../../../shared/schema/cultureMap";
import { SYSTEM_CULTURE_OWNER_ID } from "../../../shared/cultureMap";
import { countryCultureSeedProfiles } from "./dataset";
import { organizationCultureSeedProfiles } from "./organizationDataset";

/** Insert immutable, versioned system profiles without overwriting edits or
 * resurrecting deleted rows. Profile and initial history commit together.
 */
async function seedProfiles(
  profiles: typeof countryCultureSeedProfiles,
  connection: Pick<typeof db, "transaction"> = db,
) {
  return connection.transaction(async tx => {
    let inserted = 0;
    for (const { id, content } of profiles) {
      const rows = await tx.insert(cultureProfiles)
        .values({ id, ownerId: SYSTEM_CULTURE_OWNER_ID, content })
        .onConflictDoNothing({ target: cultureProfiles.id }).returning({ id: cultureProfiles.id });
      if (!rows.length) continue;
      await tx.insert(cultureProfileVersions)
        .values({ profileId: id, version: 1, content, createdBy: SYSTEM_CULTURE_OWNER_ID });
      inserted++;
    }
    return { total: profiles.length, inserted, preserved: profiles.length - inserted };
  });
}

export async function seedCountryCultureProfiles(connection: Pick<typeof db, "transaction"> = db) {
  return seedProfiles(countryCultureSeedProfiles, connection);
}

export async function seedOrganizationCultureProfiles(connection: Pick<typeof db, "transaction"> = db) {
  return connection.transaction(async tx => {
    let inserted = 0;
    let updated = 0;
    let preserved = 0;
    for (const { id, content } of organizationCultureSeedProfiles) {
      let [row] = await tx.select().from(cultureProfiles).where(eq(cultureProfiles.id, id)).for("update");
      if (!row) {
        const [created] = await tx.insert(cultureProfiles)
          .values({ id, ownerId: SYSTEM_CULTURE_OWNER_ID, content })
          .onConflictDoNothing({ target: cultureProfiles.id }).returning();
        if (created) {
          await tx.insert(cultureProfileVersions)
            .values({ profileId: id, version: 1, content, createdBy: SYSTEM_CULTURE_OWNER_ID });
          inserted++;
          continue;
        }
        // Another startup may have inserted this profile concurrently.
        [row] = await tx.select().from(cultureProfiles).where(eq(cultureProfiles.id, id)).for("update");
      }

      // Do not resurrect deleted profiles or overwrite a newer editorial
      // revision. Older profile contents remain available in version history.
      if (!row || row.isDeleted || compareRevisions(
        content.assessment?.revision,
        row.content.assessment?.revision,
      ) <= 0) {
        preserved++;
        continue;
      }

      const nextVersion = row.version + 1;
      const [replacement] = await tx.update(cultureProfiles).set({
        content,
        version: nextVersion,
        updatedAt: new Date(),
      }).where(and(
        eq(cultureProfiles.id, id),
        eq(cultureProfiles.version, row.version),
        eq(cultureProfiles.isDeleted, false),
      )).returning();
      if (!replacement) throw new Error(`Could not append organization culture revision for ${id}`);
      await tx.insert(cultureProfileVersions).values({
        profileId: id,
        version: nextVersion,
        content,
        createdBy: SYSTEM_CULTURE_OWNER_ID,
      });
      updated++;
    }
    return { total: organizationCultureSeedProfiles.length, inserted, updated, preserved };
  });
}

function compareRevisions(next?: string, current?: string): number {
  if (!next) return 0;
  if (!current) return 1;
  const nextParts = next.split(".").map(Number);
  const currentParts = current.split(".").map(Number);
  if ([...nextParts, ...currentParts].some(part => !Number.isFinite(part))) return next.localeCompare(current);
  for (let index = 0; index < Math.max(nextParts.length, currentParts.length); index++) {
    const difference = (nextParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
