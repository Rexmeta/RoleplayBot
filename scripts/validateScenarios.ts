import 'dotenv/config';
import { db } from '../server/storage/db';
import { scenarios, mbtiPersonas, scenarioTranslations, supportedLanguages } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { validateScenario } from '../server/services/scenarios/scenarioValidator';

const SEVERITY_ICON: Record<string, string> = {
  error: '❌',
  warning: '⚠️ ',
  info: 'ℹ️ ',
};

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

async function main() {
  console.log('🔍 시나리오 품질 검증 시작...\n');

  const [allScenarios, allPersonas, allTranslations, allLangs] = await Promise.all([
    db.select().from(scenarios).where(eq(scenarios.isDeleted, false)),
    db.select().from(mbtiPersonas),
    db.select().from(scenarioTranslations),
    db.select().from(supportedLanguages).where(eq(supportedLanguages.isActive, true)),
  ]);

  const mbtiPersonaIds = new Set(allPersonas.map(p => p.id));
  const activeLangs = allLangs.map(l => l.code);

  let totalScenarios = 0;
  let scenariosWithErrors = 0;
  let scenariosWithWarnings = 0;
  let totalScore = 0;

  const results = allScenarios.map(scenario => {
    const translations = allTranslations.filter(t => t.scenarioId === scenario.id);
    return validateScenario(scenario, mbtiPersonaIds, translations, activeLangs);
  });

  results.sort((a, b) => a.score - b.score);

  for (const result of results) {
    totalScenarios++;
    totalScore += result.score;

    const scoreColor = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
    console.log(`${scoreColor} [${result.score}/100] ${result.scenarioTitle} (${result.scenarioId})`);

    if (result.issues.length === 0) {
      console.log('   ✅ 모든 항목 통과\n');
      continue;
    }

    const sortedIssues = [...result.issues].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

    for (const issue of sortedIssues) {
      console.log(`   ${SEVERITY_ICON[issue.severity]} [항목 ${issue.check}] ${issue.message}`);
    }

    if (result.hasFatalErrors) {
      scenariosWithErrors++;
      console.log(`   ‼️  치명적 오류 있음 — 저장/발행 차단`);
    } else if (result.issues.some(i => i.severity === 'warning')) {
      scenariosWithWarnings++;
    }

    console.log('');
  }

  const avgScore = totalScenarios > 0 ? Math.round(totalScore / totalScenarios) : 0;

  console.log('─'.repeat(60));
  console.log(`📊 검증 완료: 총 ${totalScenarios}개 시나리오`);
  console.log(`   평균 품질 점수: ${avgScore}/100`);
  console.log(`   치명적 오류:    ${scenariosWithErrors}개`);
  console.log(`   경고:           ${scenariosWithWarnings}개`);
  console.log(`   정상:           ${totalScenarios - scenariosWithErrors - scenariosWithWarnings}개`);

  process.exit(scenariosWithErrors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('검증 중 오류 발생:', err);
  process.exit(2);
});
