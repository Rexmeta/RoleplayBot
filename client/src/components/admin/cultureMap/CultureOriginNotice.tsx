import { EDITORIAL_CULTURE_NOTICE, type CultureProfileInput } from "@shared/cultureMap";

const confidenceLabels = { low: "낮음", medium: "중간", high: "높음" };
export function CultureOriginNotice({ origin }: { origin?: CultureProfileInput["origin"] }) {
  if (!origin) return null;
  const original = origin.originalProfile;
  return <aside className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    <p className="font-medium">{EDITORIAL_CULTURE_NOTICE}</p>
    <p className="mt-1">공식 점수 아님 · 검토 필요 · 신뢰도 {confidenceLabels[original.confidence]} (해석의 확신도이며 통계적 신뢰수준이 아닙니다)</p>
    <p className="mt-1 text-xs">국가 코드 {original.countryCode} · 데이터 v{original.profileVersion} · 스키마 {original.schemaVersion} · {origin.createdOn}</p>
    <details className="mt-2">
      <summary className="cursor-pointer font-medium">원본 데이터와 척도 변환 보기</summary>
      <p className="mt-2">원본 설득 축: 적용 우선 → 원리 우선. 앱 설득 축: 원리 우선 → 적용 우선. 앱 적용값은 100 − 원본값입니다. 원본 {original.dimensions.persuading} → 기본 적용 {100 - original.dimensions.persuading}.</p>
      <p className="mt-2 break-words">작성 방식: {origin.method}</p>
      <p className="mt-1 break-words">원본 고지: {origin.importantNotice}</p>
      <p className="mt-1">참고문헌은 점수의 공식 측정·검증 근거가 아닙니다. 원본 메타데이터와 수치는 아래에 보존돼 있습니다.</p>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 text-xs">{JSON.stringify(original, null, 2)}</pre>
    </details>
  </aside>;
}
