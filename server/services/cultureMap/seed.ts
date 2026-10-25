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
  return seedProfiles(organizationCultureSeedProfiles, connection);
}
