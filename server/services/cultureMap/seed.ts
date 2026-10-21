import { db } from "../../storage/db";
import { cultureProfiles, cultureProfileVersions } from "../../../shared/schema/cultureMap";
import { SYSTEM_CULTURE_OWNER_ID } from "../../../shared/cultureMap";
import { countryCultureSeedProfiles } from "./dataset";

/** Deterministic identity = countryCode + source version + profile type.
 * Insert only. Never overwrite existing/custom/edited rows or resurrect deletes.
 * Profile and initial history are committed together, including across restarts.
 */
export async function seedCountryCultureProfiles(connection: Pick<typeof db, "transaction"> = db) {
  return connection.transaction(async tx => {
    let inserted = 0;
    for (const { id, content } of countryCultureSeedProfiles) {
      const rows = await tx.insert(cultureProfiles)
        .values({ id, ownerId: SYSTEM_CULTURE_OWNER_ID, content })
        .onConflictDoNothing({ target: cultureProfiles.id }).returning({ id: cultureProfiles.id });
      if (!rows.length) continue;
      await tx.insert(cultureProfileVersions)
        .values({ profileId: id, version: 1, content, createdBy: SYSTEM_CULTURE_OWNER_ID });
      inserted++;
    }
    return { total: countryCultureSeedProfiles.length, inserted, preserved: countryCultureSeedProfiles.length - inserted };
  });
}
