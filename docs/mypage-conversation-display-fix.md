# MyPage 대화 기록 표시 개선

## 문제점

1. **완료/진행중 대화 중복 표시**: 같은 페르소나와의 대화가 "완료"와 "진행중" 두 개로 표시됨
2. **시도 횟수 구분 불가**: 같은 날짜에 같은 페르소나와 여러 번 대화한 경우 몇 번째 시도인지 알 수 없음

## 해결 방안

### 1단계: 진행중 대화 필터링

**현재 코드 (486줄):**
```typescript
{dateConversations.map((conversation: Conversation) => {
  // 모든 대화 표시 (진행중 + 완료)
```

**개선 방안 A - 완료된 대화만 표시 (권장)**
```typescript
{dateConversations
  .filter((c: Conversation) => c.status === 'completed')
  .map((conversation: Conversation) => {
```

**개선 방안 B - 진행중 대화 별도 섹션**
- 완료된 대화는 기존대로 표시
- 진행중 대화는 페이지 상단에 별도 섹션으로 표시

### 2단계: 시도 번호 추가

**구현 방법:**
```typescript
{dateConversations
  .filter((c: Conversation) => c.status === 'completed')
  .map((conversation: Conversation, index: number) => {
    // 같은 페르소나의 시도 번호 계산
    const personaConversations = dateConversations.filter(
      c => c.personaId === conversation.personaId && 
           c.status === 'completed'
    ).sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    const attemptNumber = personaConversations.findIndex(
      c => c.id === conversation.id
    ) + 1;
    
    return (
      <div>
        {/* 시도 번호 뱃지 표시 */}
        {personaConversations.length > 1 && (
          <Badge>#{attemptNumber}회 시도</Badge>
        )}
```

### 3단계: UI 개선

**추가 표시 정보:**
- 시도 번호: "1회 시도", "2회 시도" 등
- 시간 표시: "09:36", "09:46" 등 (이미 구현됨)
- 이전 시도와의 점수 차이 표시 (선택사항)

## 권장 구현

### 옵션 1: 완료된 대화만 표시 (간단)
- 진행중 대화는 숨김
- 완료된 대화만 시도 번호와 함께 표시

### 옵션 2: 진행중 대화 별도 관리 (복잡)
- 페이지 상단에 "진행중인 대화" 섹션 추가
- 날짜별 섹션에는 완료된 대화만 표시
- 각 대화에 시도 번호 추가

## 구현 우선순위

1. **높음**: 완료된 대화만 표시 (진행중 대화 필터링)
2. **중간**: 시도 번호 추가
3. **낮음**: 진행중 대화 별도 섹션 (필요시)
