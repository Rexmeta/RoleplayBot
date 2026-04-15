# Persona X 씬 생성기 (Persona X Scene Generator)

> **소스**: `server/services/personaSceneGenerator.ts`  
> **최초 작성**: 2026-04-15

---

## 1. 개요

사용자가 AI 페르소나와 대화를 시작하기 전에 몰입감 있는 **씬(Scene)**을 생성하는 모듈이다. 사용자가 입력한 아이디어(자유 텍스트)를 기반으로 Gemini API를 호출해 배경·분위기·첫 마디를 생성한다.

---

## 2. 입력 스키마 (`PersonaSceneGenerateRequest`)

```typescript
interface PersonaSceneGenerateRequest {
  idea: string;              // 사용자가 입력한 씬 아이디어 (자유 텍스트)
  personaName: string;       // 페르소나 이름
  personaDescription?: string; // 페르소나 설명 (선택)
}
```

---

## 3. 출력 스키마 (`PersonaScene`)

```typescript
interface PersonaScene {
  title: string;       // 장면 제목 (최대 200자)
  setting: string;     // 배경 설명 (최대 1000자)
  mood: string;        // 분위기 키워드 (최대 500자)
  openingLine: string; // 페르소나의 첫 마디 (최대 1000자)
  genre: string;       // 장르 (최대 100자)
}
```

---

## 4. Gemini 호출 방식

### `generatePersonaScene(request)` — 씬 전체 생성

| 항목 | 값 |
|------|-----|
| 모델 | `gemini-2.5-flash` |
| 응답 형식 | `application/json` (Gemini JSON Schema 강제) |
| `maxOutputTokens` | 1024 |
| `temperature` | 0.85 |

**JSON Schema** (Gemini에 직접 전달):
```json
{
  "type": "object",
  "properties": {
    "title":       { "type": "string" },
    "setting":     { "type": "string" },
    "mood":        { "type": "string" },
    "openingLine": { "type": "string" },
    "genre":       { "type": "string" }
  },
  "required": ["title", "setting", "mood", "openingLine", "genre"]
}
```

**장르 값**: `로맨스 | 판타지 | 미스터리 | SF | 일상 | 직장 | 학교 | 역사`

---

### `generateSceneOpeningLine(personaName, scene, personaDescription?)` — 첫 마디만 재생성

| 항목 | 값 |
|------|-----|
| 모델 | `gemini-2.5-flash` |
| 응답 형식 | 텍스트 (plain text) |
| `maxOutputTokens` | 256 |
| `temperature` | 0.9 |

기존 씬의 `setting`·`mood`·`genre`를 컨텍스트로 전달해 페르소나의 첫 마디 1–2문장을 생성한다.  
응답이 비어 있으면 기본값 반환: `"안녕하세요. {setting 앞 30자}... 어떻게 도와드릴까요?"`

---

## 5. JSON 파싱 흐름

```
Gemini 응답 텍스트 수신
        │
        ▼
extractText(response) — 다중 응답 구조 처리
  ├─ response.text() 함수인 경우 → 호출
  ├─ response.text 문자열인 경우 → 직접 사용
  └─ candidates[0].content.parts[0].text 경로 시도
        │
        ▼
코드 펜스 제거: ```json\n ... ``` → 순수 JSON 문자열
        │
        ▼
JSON.parse()
  └─ 실패 → Error("AI 응답 JSON 파싱 실패") throw
        │
        ▼
Zod 스키마 검증 (personaSceneSchema.safeParse)
  ├─ 성공 → validated.data 반환
  └─ 실패 → partial 파싱으로 graceful 반환
             (각 필드 String()으로 강제 변환 + 길이 절삭)
```

**Graceful 폴백**: Zod 검증 실패 시에도 에러를 throw하지 않고, 파싱된 raw 데이터에서 각 필드를 `String()`으로 강제 변환해 반환한다. 기본값은 `title: "새 장면"`, `genre: "일상"`.

---

## 6. 환경변수

| 변수 | 필수 여부 | 설명 |
|------|---------|------|
| `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY` | 필수 | GoogleGenAI 클라이언트 초기화에 사용 |

---

## 7. 사용 위치

- 사용자가 Persona X 캐릭터 모드에서 새 씬을 만들 때 호출됨
- 씬 생성 → 대화 시작 시 `openingLine`이 AI의 첫 발화로 사용됨
- 씬 재생성이 필요한 경우 `generateSceneOpeningLine()`만 별도 호출 가능
