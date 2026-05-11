import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { scenarios } from "../../shared/schema";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL!;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});
const db = drizzle(pool);

const ESTIMATED_TIME_MAP: Record<number, string> = {
  1: "5~8분",
  2: "7~10분",
  3: "10~15분",
  4: "12~20분",
};

async function backfillEstimatedTime() {
  console.log("🔄 estimatedTime 백필 시작...");

  const allScenarios = await db
    .select({ id: scenarios.id, difficulty: scenarios.difficulty, estimatedTime: scenarios.estimatedTime })
    .from(scenarios);

  console.log(`📋 전체 시나리오 수: ${allScenarios.length}`);

  let updated = 0;
  let skipped = 0;

  for (const scenario of allScenarios) {
    const difficulty = scenario.difficulty ?? 3;
    const correctTime = ESTIMATED_TIME_MAP[difficulty] || ESTIMATED_TIME_MAP[3];

    if (scenario.estimatedTime === correctTime) {
      skipped++;
      continue;
    }

    await db
      .update(scenarios)
      .set({ estimatedTime: correctTime })
      .where(eq(scenarios.id, scenario.id));

    console.log(
      `✅ 업데이트: ${scenario.id} | 난이도 ${difficulty} | ${scenario.estimatedTime ?? "(없음)"} → ${correctTime}`
    );
    updated++;
  }

  console.log(`\n📊 완료: ${updated}개 업데이트, ${skipped}개 스킵 (이미 정확)`);
  await pool.end();
}

backfillEstimatedTime().catch((err) => {
  console.error("❌ 오류:", err);
  pool.end();
  process.exit(1);
});
