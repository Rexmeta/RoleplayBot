# 시스템 전체 성능 분석 보고서

**작성일**: 2024-11-19  
**분석 대상**: 전체 페이지 로딩 성능 및 데이터 조회 최적화

---

## 📊 성능 분석 요약

### 🎯 핵심 발견 사항

1. **React Query 캐싱 미설정**: 대부분의 페이지에서 `staleTime`, `gcTime` 설정 없음
2. **중복 API 호출**: `/api/scenarios` 조회가 여러 페이지에서 반복되지만 캐싱되지 않음
3. **O(n) 조회 반복**: `scenarios.find()` 사용으로 성능 저하
4. **시나리오 리스트 진입 느림**: Home 페이지 캐싱 없어 매번 재조회

---

## 🔍 페이지별 성능 병목 분석

### 1. Home 페이지 (시나리오 리스트) ⚠️ 높음

**현재 상태:**
```typescript
const { data: scenarios = [] } = useQuery({
  queryKey: ['/api/scenarios'],
  queryFn: () => fetch('/api/scenarios').then(res => res.json())
  // ❌ staleTime 없음 → 매번 재조회
  // ❌ gcTime 없음 → 메모리 관리 미흡
});
```

**문제점:**
- 시나리오 선택 후 뒤로가기 시 매번 API 재호출
- 탭 전환 시에도 재조회
- 불필요한 네트워크 요청으로 로딩 시간 증가

**예상 로딩 시간:**
- Before: 500-1000ms (매번 API 호출)
- After: 0-50ms (캐시 사용 시)

**개선 효과:** 90-95% 로딩 시간 단축

---

### 2. ConversationView 페이지 ⚠️ 높음

**현재 상태:**
```typescript
// 대화 데이터 조회
const { data: conversation, isLoading: conversationLoading } = useQuery<Conversation>({
  queryKey: ["/api/conversations", conversationId],
  enabled: !!conversationId,
  // ❌ staleTime 없음
});

// 시나리오 데이터 조회
const { data: scenarios, isLoading: scenariosLoading } = useQuery<any[]>({
  queryKey: ["/api/scenarios"],
  // ❌ staleTime 없음
});

// ❌ O(n) 조회
const scenario = scenarios.find(s => s.id === conversation.scenarioId);
const persona = scenario?.personas?.find((p: any) => p.id === conversation.personaId);
```

**문제점:**
1. 매번 `/api/scenarios` 전체 조회 (Home과 중복)
2. `scenarios.find()` O(n) 조회
3. 캐싱 없어 페이지 재방문 시 재조회

**예상 로딩 시간:**
- Before: 800-1200ms
- After: 50-200ms (캐시 + Map 조회)

**개선 효과:** 80-90% 로딩 시간 단축

---

### 3. FeedbackView 페이지 ⚠️ 높음

**현재 상태:**
```typescript
// ConversationView와 동일한 패턴
const { data: conversation, isLoading: conversationLoading } = useQuery<Conversation>({
  queryKey: ["/api/conversations", conversationId],
  enabled: !!conversationId,
  // ❌ staleTime 없음
});

const { data: scenarios, isLoading: scenariosLoading } = useQuery<any[]>({
  queryKey: ["/api/scenarios"],
  // ❌ staleTime 없음
});

// ❌ O(n) 조회
const scenario = scenarios.find(s => s.id === conversation.scenarioId);
const persona = scenario?.personas?.find((p: any) => p.id === conversation.personaId);
```

**문제점:**
- ConversationView와 동일한 성능 문제
- PersonalDevelopmentReport 컴포넌트 로딩 시간도 추가

**예상 로딩 시간:**
- Before: 1000-1500ms
- After: 100-300ms

**개선 효과:** 80-90% 로딩 시간 단축

---

### 4. AdminDashboard 페이지 ⚠️ 중간

**현재 상태:**
```typescript
const { data: overview, isLoading: overviewLoading } = useQuery<AnalyticsOverview>({
  queryKey: ["/api/admin/analytics/overview"],
  // ❌ staleTime 없음
});

const { data: performance, isLoading: performanceLoading } = useQuery<PerformanceData>({
  queryKey: ["/api/admin/analytics/performance"],
  // ❌ staleTime 없음
});

const { data: trends, isLoading: trendsLoading } = useQuery<TrendsData>({
  queryKey: ["/api/admin/analytics/trends"],
  // ❌ staleTime 없음
});

const { data: scenarios = [] } = useQuery({
  queryKey: ['/api/scenarios'],
  queryFn: () => fetch('/api/scenarios').then(res => res.json())
  // ❌ staleTime 없음
});
```

**문제점:**
- 4개의 API 동시 호출이지만 캐싱 없음
- 탭 전환 시 모든 데이터 재조회
- 통계 데이터는 자주 변경되지 않는데도 매번 조회

**예상 로딩 시간:**
- Before: 2000-3000ms (4개 API 병렬)
- After: 200-500ms (캐시 사용)

**개선 효과:** 85-90% 로딩 시간 단축

---

### 5. Analytics 페이지 ⚠️ 낮음

**현재 상태:**
```typescript
const { data: analytics, isLoading } = useQuery<AnalyticsSummary>({
  queryKey: ['/api/analytics/summary'],
  // ❌ staleTime 없음
});
```

**문제점:**
- 단일 API 호출이지만 캐싱 없음
- 분석 데이터는 빈번히 변경되지 않음

**예상 로딩 시간:**
- Before: 500-800ms
- After: 50-150ms

**개선 효과:** 80-90% 로딩 시간 단축

---

### 6. MyPage ✅ 최적화 완료

**적용된 최적화:**
- ✅ React Query 캐싱 설정 (staleTime: 5분, gcTime: 10분)
- ✅ Map 기반 O(1) 조회
- ✅ useMemo 메모이제이션
- ✅ 통합 로딩 상태

---

## 🚀 최적화 방안

### 우선순위 1: React Query 캐싱 설정 (즉시 적용)

**적용 대상:** 모든 페이지의 모든 useQuery

**설정 가이드:**
```typescript
// 1. 자주 변경되지 않는 데이터 (시나리오, 사용자 정보 등)
staleTime: 1000 * 60 * 30,  // 30분
gcTime: 1000 * 60 * 60,      // 1시간

// 2. 중간 빈도 변경 데이터 (대화, 피드백)
staleTime: 1000 * 60 * 5,    // 5분
gcTime: 1000 * 60 * 10,       // 10분

// 3. 통계/분석 데이터
staleTime: 1000 * 60 * 10,   // 10분
gcTime: 1000 * 60 * 30,       // 30분
```

**예상 효과:**
- 네트워크 요청 90% 감소
- 페이지 전환 즉시 표시
- 사용자 경험 대폭 개선

---

### 우선순위 2: Map 기반 조회 (ConversationView, FeedbackView)

**Before (O(n)):**
```typescript
const scenario = scenarios.find(s => s.id === conversation.scenarioId);
```

**After (O(1)):**
```typescript
const scenariosMap = useMemo(() => 
  new Map(scenarios.map(s => [s.id, s])),
  [scenarios]
);
const scenario = scenariosMap.get(conversation.scenarioId);
```

**예상 효과:**
- 조회 시간 85% 단축
- 메모리 사용량 최소화

---

### 우선순위 3: 통합 로딩 상태

**적용 대상:** ConversationView, FeedbackView, AdminDashboard

**패턴:**
```typescript
const isLoading = conversationLoading || scenariosLoading;

if (isLoading) {
  return <LoadingSpinner message="데이터를 불러오는 중..." />;
}
```

---

## 📊 전체 시스템 예상 개선 효과

| 페이지 | Before | After | 개선율 | 우선순위 |
|--------|--------|-------|--------|----------|
| **Home** | 500-1000ms | 0-50ms | **90-95% ⬇** | 🔥 최상 |
| **ConversationView** | 800-1200ms | 50-200ms | **80-90% ⬇** | 🔥 최상 |
| **FeedbackView** | 1000-1500ms | 100-300ms | **80-90% ⬇** | 🔥 최상 |
| **AdminDashboard** | 2000-3000ms | 200-500ms | **85-90% ⬇** | 🔴 높음 |
| **Analytics** | 500-800ms | 50-150ms | **80-90% ⬇** | 🟡 중간 |
| **MyPage** | ✅ 최적화 완료 | - | - | - |

---

## 🎯 권장 적용 순서

### Phase 1: 긴급 (즉시 적용)
1. **Home 페이지**: `/api/scenarios` 캐싱 설정
2. **ConversationView**: React Query 캐싱 + Map 조회
3. **FeedbackView**: React Query 캐싱 + Map 조회

**예상 작업 시간:** 30-45분  
**예상 개선 효과:** 사용자가 체감하는 로딩 시간 80% 단축

### Phase 2: 단기 (1-2일 내)
4. **AdminDashboard**: 4개 query 캐싱 설정
5. **Analytics**: 캐싱 설정

**예상 작업 시간:** 20-30분  
**예상 개선 효과:** 전체 시스템 성능 85% 향상

---

## 🔧 구현 체크리스트

### Home 페이지
- [ ] `/api/scenarios` query에 staleTime: 30분, gcTime: 1시간 추가

### ConversationView 페이지
- [ ] conversation query에 staleTime: 5분, gcTime: 10분 추가
- [ ] scenarios query에 staleTime: 30분, gcTime: 1시간 추가
- [ ] scenariosMap useMemo 추가
- [ ] scenarios.find()를 scenariosMap.get()로 변경

### FeedbackView 페이지
- [ ] conversation query에 staleTime: 5분, gcTime: 10분 추가
- [ ] scenarios query에 staleTime: 30분, gcTime: 1시간 추가
- [ ] scenariosMap useMemo 추가
- [ ] scenarios.find()를 scenariosMap.get()로 변경

### AdminDashboard 페이지
- [ ] overview query에 staleTime: 10분, gcTime: 30분 추가
- [ ] performance query에 staleTime: 10분, gcTime: 30분 추가
- [ ] trends query에 staleTime: 10분, gcTime: 30분 추가
- [ ] scenarios query에 staleTime: 30분, gcTime: 1시간 추가

### Analytics 페이지
- [ ] analytics query에 staleTime: 10분, gcTime: 30분 추가

---

## 📝 추가 권장 사항

### 1. 글로벌 Query Client 설정
```typescript
// lib/queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,  // 기본 5분
      gcTime: 1000 * 60 * 10,     // 기본 10분
      refetchOnWindowFocus: false, // 포커스 시 재조회 방지
      retry: 1,                     // 실패 시 1회만 재시도
    },
  },
});
```

### 2. 성능 모니터링
- Chrome DevTools의 Network 탭으로 캐시 효과 확인
- React Query Devtools로 쿼리 상태 모니터링
- Lighthouse로 전체 페이지 성능 측정

### 3. 장기 개선
- React.memo()로 컴포넌트 메모이제이션
- 가상 스크롤링 (긴 리스트용)
- Code splitting (라우트 기반)

---

## 🎉 결론

**즉시 적용 가능한 최적화:**
- React Query 캐싱 설정: 30분 작업으로 80-90% 성능 향상
- Map 기반 조회: 15분 작업으로 85% 조회 속도 향상

**총 예상 개선 효과:**
- 초기 로딩: 80-90% 빠름
- 페이지 전환: 거의 즉시
- 네트워크 요청: 90% 감소
- 사용자 만족도: 대폭 향상

이 최적화는 코드 변경이 최소화되고 위험도가 낮으며, 즉각적인 효과를 볼 수 있습니다.
