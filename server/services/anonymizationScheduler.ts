import { storage } from "../storage";
import { db } from "../storage/db";
import { auditLogs } from "@shared/schema";

const DEFAULT_RETENTION_DAYS = 365;

async function getRetentionDays(): Promise<number> {
  try {
    const setting = await storage.getSystemSetting('privacy', 'data_retention_days');
    if (setting?.value) {
      const parsed = parseInt(setting.value, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (err) {
    console.warn('[anonymizationScheduler] Could not read retention setting:', err);
  }
  return DEFAULT_RETENTION_DAYS;
}

async function runWarningPass(retentionDays: number): Promise<void> {
  let approaching: Awaited<ReturnType<typeof storage.getUsersApproachingRetention>>;
  try {
    approaching = await storage.getUsersApproachingRetention(retentionDays, 7);
  } catch (err) {
    console.warn('[anonymizationScheduler] Could not fetch approaching-retention users:', err);
    return;
  }

  if (approaching.length === 0) return;

  console.log(`[anonymizationScheduler] ${approaching.length} user(s) will be anonymized within 7 days (pre-expiry warning).`);

  for (const user of approaching) {
    try {
      await db.insert(auditLogs).values({
        actorUserId: null,
        action: 'anonymization_warning',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          triggerType: 'pre_expiry_warning',
          retentionDays,
          warningDays: 7,
          note: 'User will be auto-anonymized within 7 days (log-only notification)',
        },
      });
    } catch (err) {
      console.warn(`[anonymizationScheduler] Could not write warning log for user ${user.id}:`, err);
    }
  }
}

async function runAnonymizationPass(): Promise<void> {
  const retentionDays = await getRetentionDays();
  console.log(`[anonymizationScheduler] Running pass with retention=${retentionDays}d`);

  await runWarningPass(retentionDays);

  let eligible: Awaited<ReturnType<typeof storage.getUsersEligibleForAnonymization>>;
  try {
    eligible = await storage.getUsersEligibleForAnonymization(retentionDays);
  } catch (err) {
    console.error('[anonymizationScheduler] Failed to fetch eligible users:', err);
    return;
  }

  if (eligible.length === 0) {
    console.log('[anonymizationScheduler] No users eligible for anonymization.');
    return;
  }

  console.log(`[anonymizationScheduler] Found ${eligible.length} users eligible for anonymization.`);

  for (const user of eligible) {
    try {
      await storage.anonymizeUser(user.id, null, 'scheduled');
      await db.insert(auditLogs).values({
        actorUserId: null,
        action: 'anonymize_user',
        targetType: 'user',
        targetId: user.id,
        metadata: {
          triggerType: 'scheduled',
          retentionDays,
        },
      });
      console.log(`[anonymizationScheduler] Anonymized user ${user.id}`);
    } catch (err) {
      console.error(`[anonymizationScheduler] Failed to anonymize user ${user.id}:`, err);
    }
  }
}

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

export function startAnonymizationScheduler(): void {
  runAnonymizationPass().catch(err =>
    console.error('[anonymizationScheduler] Initial pass error:', err)
  );

  const scheduleNext = () => {
    const ms = msUntilMidnight();
    console.log(`[anonymizationScheduler] Next run in ${Math.round(ms / 60000)} minutes.`);
    setTimeout(async () => {
      await runAnonymizationPass().catch(err =>
        console.error('[anonymizationScheduler] Daily pass error:', err)
      );
      scheduleNext();
    }, ms);
  };

  scheduleNext();
}
