# 시스템 전체 성능 현황 보고서

**최종 업데이트**: 2026-08  
**분석 대상**: 전체 페이지 로딩 성능 및 데이터 조회 최적화

---

## 📊 적용된 최적화 요약

### React Query 글로벌 설정 ✅ 적용 완료

`client/src/lib/queryClient.ts`:

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,   // ✅ 전역 staleTime: Infinity (명시적 invalidate 없이 재조회 없음)
      retry: false,
    },
  },
});
```

전역 `staleTime: Infinity` 설정으로 탭 전환·화면 복귀 시 불필요한 API 재조회가 기본적으로 발생하지 않는다.

---

## 🔍 페이지별 캐싱 현황

### ConversationView 페이지 ✅ 최적화 완료

```typescript
// 대화 데이터 (5분 stale, 10분 gc)
staleTime: 1000 * 60 * 5,
gcTime: 1000 * 60 * 10,

// 시나리오 데이터 (30분 stale, 60분 gc)
staleTime: 1000 * 60 * 30,
gcTime: 1000 * 60 * 60,
```

### FeedbackView 페이지 ✅ 최적화 완료

```typescript
// 대화·피드백 데이터 (5분 stale, 10분 gc)
staleTime: 1000 * 60 * 5,
gcTime: 1000 * 60 * 10,

// 시나리오·정적 데이터 (30분 stale, 60분 gc)
staleTime: 1000 * 60 * 30,
gcTime: 1000 * 60 * 60,

// 분석 데이터 (10분 stale, 30분 gc)
staleTime: 1000 * 60 * 10,
gcTime: 1000 * 60 * 30,
```

### MyPage 페이지 ✅ 최적화 완료

```typescript
// 기본 사용자·통계 데이터 (5분 stale, 10분 gc)
staleTime: 1000 * 60 * 5,
gcTime: 1000 * 60 * 10,

// 시나리오·정적 데이터 (30분 stale, 60분 gc)
staleTime: 1000 * 60 * 30,
gcTime: 1000 * 60 * 60,

// 활동 데이터 (1분 stale)
staleTime: 1000 * 60,
gcTime: 1000 * 60 * 5,

// 분석 데이터 (10분 stale)
staleTime: 1000 * 60 * 10,
```

---

## 📊 페이지별 현황 요약

| 페이지 | React Query 캐싱 | 글로벌 staleTime | 상태 |
|--------|-----------------|----------------|------|
| **ConversationView** | ✅ 명시적 staleTime/gcTime | Infinity (전역) | ✅ 최적화 완료 |
| **FeedbackView** | ✅ 명시적 staleTime/gcTime | Infinity (전역) | ✅ 최적화 완료 |
| **MyPage** | ✅ 명시적 staleTime/gcTime | Infinity (전역) | ✅ 최적화 완료 |
| **Home** | 글로벌 Infinity 상속 | Infinity | ✅ 전역 설정으로 커버됨 |
| **AdminDashboard** | 글로벌 Infinity 상속 | Infinity | ✅ 전역 설정으로 커버됨 |

---

## 🔧 향후 개선 포인트

### 1. Map 기반 O(1) 조회

대용량 시나리오 목록에서 `scenarios.find()`를 `useMemo` + `Map`으로 대체하면 탐색 성능을 개선할 수 있다:

```typescript
// Before: O(n) 선형 탐색
const scenario = scenarios.find(s => s.id === conversation.scenarioId);

// After: O(1) Map 탐색
const scenariosMap = useMemo(
  () => new Map(scenarios.map(s => [s.id, s])),
  [scenarios]
);
const scenario = scenariosMap.get(conversation.scenarioId);
```

### 2. 성능 모니터링

- Chrome DevTools Network 탭으로 캐시 효과 확인
- React Query Devtools로 쿼리 상태 모니터링

### 3. 장기 개선

- `React.memo()`로 컴포넌트 메모이제이션
- 가상 스크롤링 (긴 리스트용)
- Code splitting (라우트 기반)

---

## 📝 참고

서버 사이드 AI 응답 성능 최적화 (캐싱, 병렬 처리, 스트리밍 등)는 이미 `OptimizedGeminiProvider`에 적용되어 있다.
- `conversationSemaphore`로 동시 요청 제어
- `GlobalMBTICache`로 MBTI 파일 I/O 제거
- `enrichedPersonaCache`로 페르소나 enrichment 캐시
- `retryWithBackoff`로 API 오류 복구
- SSE 스트리밍으로 초기 응답 시간 단축 (`generateStreamingAIResponse`)
