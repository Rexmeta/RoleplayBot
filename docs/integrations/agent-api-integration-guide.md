# Agent API 연동 가이드 (웹게임·외부 서비스용)

"롤플레이 시작 → 결과 수신 → 게임 상태 반영"을 몇 줄로 구현하는 방법입니다.

| 구성 요소 | 위치 |
|---|---|
| 서버용 TypeScript 클라이언트 | `sdk/agent-api/client.ts` |
| 브라우저 임베드 스크립트 | `sdk/agent-api/embed.js` (서버에서 `/api/v1/agent/sdk/embed.js`로 제공) |
| 동작하는 예제 웹게임 | `examples/agent-web-game/` |
| API 레퍼런스 | `/api/v1/agent/docs` |

## 1. API 키 발급

운영자/관리자가 관리 화면(시스템 관리 → API 키)에서 키를 발급합니다. 이 가이드의 흐름에는 다음 권한(scope)이 필요합니다.

- `scenarios:read`, `personas:read` — 시나리오/페르소나 조회
- `sessions:create` — 세션 생성, 플레이 링크 발급
- `sessions:read` — 결과 조회
- `webhooks:manage` — 웹훅 사용 시

**플레이 링크를 iframe에 임베드하려면 키의 `allowedOrigins`에 게임 페이지의 origin(예: `https://game.example.com`)을 등록하세요.** 등록되지 않은 origin에는 완료 이벤트가 전달되지 않습니다.

키는 **서버에만** 보관하세요. 브라우저 코드나 저장소에 넣지 마세요.

## 2. 시나리오 선택

```bash
curl -H "Authorization: Bearer $AGENT_API_KEY" $BASE/api/v1/agent/scenarios
curl -H "Authorization: Bearer $AGENT_API_KEY" $BASE/api/v1/agent/personas
```

게임 장면에 맞는 `scenarioId`와 `personaId`를 고르고 게임 설정에 고정해 두는 것을 권장합니다.

## 3. 게임 맥락(gameContext) 설계

`gameContext`는 AI 페르소나의 대화와 평가에 **참고 데이터**로 주입됩니다(지시문이 아닙니다).

```ts
gameContext: {
  contextId: "scene-42",                       // 결과에 gameContextId로 되돌아옴
  sceneSummary: "길드 마스터에게 기한 연장을 부탁한다.", // ≤1000자
  objective: "기한 연장을 설득한다",              // ≤300자
  playerState: { reputation: 12, gold: 40 },   // 평면 항목 최대 20개
  recentEvents: ["캐러밴이 약탈당했다"],          // 최대 10개
}
```

원칙: 짧고 사실 위주로 쓰고, 정의되지 않은 필드는 보내지 마세요(거부됩니다). 제어 문자, 줄바꿈, `<`, `>`, 백틱은 제거되며 정제 후 4KB를 넘으면 `game_context_too_large`가 반환됩니다. 개인정보는 넣지 마세요.

## 4. 서버에서 시작하기

```ts
import { AgentApiClient } from "./sdk/agent-api/client";

const client = new AgentApiClient({ apiKey: process.env.AGENT_API_KEY!, baseUrl: "https://your-host" });

// 세션 생성 + 플레이 링크 발급을 한 번에
const { sessionId, playUrl } = await client.startRoleplay({
  scenarioId, personaId,
  externalUserId: "player-123",
  language: "ko",
  gameContext: { contextId: "scene-42", sceneSummary: "…", playerState: { reputation: 12 } },
});
// playUrl만 브라우저에 전달합니다. 링크는 1회용이며 짧게 유효합니다.
```

`startRoleplay`의 두 번째 인자 `idempotencyKey`로 재시도를 안전하게 만들 수 있습니다.

## 5. 브라우저에서 모달로 열기

```html
<script src="https://your-host/api/v1/agent/sdk/embed.js"></script>
<script>
  const modal = AgentRoleplay.open({
    playUrl, sessionId,
    onReady: () => console.log("시작됨"),
    onComplete: () => { modal.close(); /* 서버에 결과 요청 */ },
    onClose: () => {},
  });
</script>
```

스크립트는 iframe 창에서 온 메시지이면서 플레이 링크 origin과 일치하고 `source: "avatar-router"`, 해당 `sessionId`인 메시지만 처리합니다. 완료 이벤트(`session.completed`)는 종료 요청이 접수됐다는 뜻이며, 피드백 생성은 비동기이므로 아직 점수가 없을 수 있습니다.

## 6. 결과를 게임에 주입하기

**폴링**

```ts
const { result } = await client.waitForResult(sessionId, { intervalMs: 2000, timeoutMs: 120_000 });
```

**웹훅(운영 권장)** — `feedback.completed`의 `data.result`는 `GET /sessions/{id}/result`와 동일한 형태입니다.

결과 필드 활용 패턴:

| 필드 | 게임 반영 예 |
|---|---|
| `passed` | 분기 결정(통과/실패). 시나리오에 통과 규칙이 없으면 `null` |
| `overallScore` (0–100, 짧은 대화는 `null`) | 평판·보상 증감 |
| `scenarioSuccessLevel` | excellent/success/partial/failure별 장면 선택 |
| `narrativeHook` | 다음 장면 도입 문장으로 그대로 사용 |
| `strengths`/`improvements` | 힌트·튜토리얼 문구 |
| `emotionFlow.end` | NPC 태도 표현 |

점수가 `null`이면 임의 점수를 만들지 말고 중립 분기(보상·감점 없음)로 처리하세요. 반영은 항상 **서버 쪽 게임 상태**에서 하고(예제 서버가 세션당 한 번만 반영), 클라이언트가 보낸 점수를 믿지 마세요.

## 7. 웹훅 보안

1. `POST /webhooks`로 HTTPS 엔드포인트를 등록하면 서명 비밀값이 **한 번만** 반환됩니다. 서버 비밀 저장소에 보관하세요.
2. 서명은 `X-Webhook-Signature: sha256=<hex>`이며 HMAC-SHA256(원본 요청 본문)입니다. **파싱 전 원본 바이트**로 검증해야 합니다.
3. 시간 상수 비교를 사용하세요(SDK의 `verifyWebhookSignature`/`parseWebhook`이 처리).
4. `X-Webhook-Delivery-Id`로 중복 처리를 막으세요. 같은 이벤트가 재전송될 수 있습니다(최초 1회 + 최대 3회 재시도).
5. 빠르게 2xx로 응답하고 무거운 처리는 비동기로 수행하세요(전송 타임아웃 10초).

```ts
import express from "express";
import { parseWebhook } from "./sdk/agent-api/client";

app.post("/webhooks/roleplay", express.raw({ type: "application/json" }), (req, res) => {
  let evt;
  try { evt = parseWebhook(req.body, req.header("x-webhook-signature"), process.env.WEBHOOK_SECRET!); }
  catch { return res.sendStatus(401); }
  if (evt.event === "feedback.completed") { /* evt.data.result 를 게임 상태에 반영 */ }
  res.sendStatus(200);
});
```

## 8. 오류 처리

SDK는 실패 시 `AgentApiError`(`status`, `code`, `message`, `requestId`)를 던집니다. 문의 시 `requestId`를 함께 전달하세요.

| 상황 | 대응 |
|---|---|
| `401`/`403` | 키·scope 확인. 키를 사용자에게 노출하지 마세요 |
| `429` | `X-RateLimit-Reset`까지 대기 후 재시도 |
| `game_context_too_large`, `validation_error` | 맥락을 줄이거나 필드를 수정 |
| `session_ended` (플레이 링크) | 새 세션을 만드세요 |
| 플레이 링크 만료/사용됨 | 같은 세션에 새 링크를 발급 |
| 결과 `status: "failed"` | 세션 종료를 다시 호출하면 피드백을 재시도 |
| `waitForResult` 타임아웃 | 게임을 멈추지 말고 중립 분기 후 웹훅/재조회로 보정 |

## 9. 예제 실행

```bash
AGENT_API_KEY=agk_live_… AGENT_API_URL=https://your-host \
SCENARIO_ID=… PERSONA_ID=… npx tsx examples/agent-web-game/server.ts
# 웹훅까지 쓰려면 WEBHOOK_SECRET도 지정하고 /webhooks/roleplay 를 등록
```

`http://localhost:3100`에서 분기형 스토리가 열립니다. 게임이 `gameContext`와 함께 롤플레이를 호출하고, 결과의 점수와 `narrativeHook`으로 다음 장면과 평판/골드가 바뀝니다. 이 게임의 내용은 데모용입니다.
