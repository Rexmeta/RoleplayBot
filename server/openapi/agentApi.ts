const spec = {
  openapi: "3.0.3",
  info: {
    title: "Agent API",
    version: "1.0.0",
    description: `## Enterprise B2B REST API

The Agent API lets you embed AI-powered role-play training sessions into your own products.
Your end-users interact with AI personas across workplace scenarios with real-time emotion
tracking, per-turn scoring, and a full feedback report at the end of each session.

### Authentication

All endpoints require **Bearer token** authentication using your API key:

\`\`\`
Authorization: Bearer agk_live_xxxxxxxxxxxxxxxxxxxx
\`\`\`

API keys are issued by an operator or admin from the management dashboard.
Keys carry **scopes** that control which endpoints they can call.

### Rate Limiting

Each API key has a per-minute request limit configured by your operator (default: 60 req/min).
When exceeded, the API returns \`429 Too Many Requests\`.

Relevant response headers:
| Header | Description |
|---|---|
| \`X-RateLimit-Limit\` | Maximum requests per window |
| \`X-RateLimit-Remaining\` | Requests left in the current window |
| \`X-RateLimit-Reset\` | Epoch timestamp when the window resets |

### Idempotency

POST endpoints support the \`Idempotency-Key\` request header for safe retries.
Supply any unique string (e.g. a UUID). The server caches the response for 24 hours;
identical keys with the same request body replay the cached response, and keys used
with a different body return \`409 Conflict\`.

### Error Format

All errors follow a consistent envelope:

\`\`\`json
{
  "error": {
    "code": "session_not_found",
    "message": "Session not found.",
    "details": null
  },
  "requestId": "req_abc123"
}
\`\`\`
`,
    contact: {
      name: "Platform Support",
    },
  },
  servers: [
    {
      url: "/api/v1/agent",
      description: "Current server",
    },
  ],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "API Key",
        description:
          "API key issued from the operator dashboard. Format: `agk_live_<key>` or `agk_test_<key>`.",
      },
    },
    schemas: {
      ErrorEnvelope: {
        type: "object",
        required: ["error", "requestId"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                example: "session_not_found",
                description: "Machine-readable error code.",
              },
              message: {
                type: "string",
                example: "Session not found.",
              },
              details: {
                type: "object",
                nullable: true,
                description: "Extra structured detail (validation errors, etc.).",
              },
            },
          },
          requestId: {
            type: "string",
            example: "req_a1b2c3d4e5f6",
          },
        },
      },
      ScenarioSummary: {
        type: "object",
        required: ["id", "title", "category", "tags", "difficulty", "targetTurns", "personaCount"],
        properties: {
          id: { type: "string", example: "scenario_001" },
          title: { type: "string", example: "Difficult Client Meeting" },
          description: {
            type: "string",
            nullable: true,
            example: "Practice handling an upset enterprise client.",
          },
          category: { type: "string", example: "sales" },
          tags: { type: "array", items: { type: "string" }, example: ["conflict", "negotiation"] },
          difficulty: { type: "integer", minimum: 1, maximum: 5, example: 3 },
          targetTurns: { type: "integer", example: 10 },
          personaCount: { type: "integer", example: 2 },
        },
      },
      PersonaSummary: {
        type: "object",
        required: ["id", "name", "scenarioId", "scenarioTitle", "role"],
        properties: {
          id: { type: "string", example: "persona_001" },
          name: { type: "string", example: "Kim Jiyeon" },
          scenarioId: { type: "string", example: "scenario_001" },
          scenarioTitle: { type: "string", example: "Difficult Client Meeting" },
          role: { type: "string", example: "Client Manager" },
          mbti: { type: "string", nullable: true, example: "ENTJ" },
          gender: { type: "string", nullable: true, example: "female" },
        },
      },
      Session: {
        type: "object",
        required: [
          "sessionId",
          "status",
          "scenarioId",
          "personaId",
          "externalUserId",
          "language",
          "difficulty",
          "createdAt",
          "expiresAt",
          "contextLost",
          "requestId",
        ],
        properties: {
          sessionId: {
            type: "string",
            example: "ags_a1b2c3d4e5f6g7h8i9j0",
            description: "Unique session ID assigned by the server.",
          },
          status: {
            type: "string",
            enum: ["active", "ended", "expired"],
            example: "active",
          },
          scenarioId: { type: "string", example: "scenario_001" },
          personaId: { type: "string", example: "persona_001" },
          externalUserId: {
            type: "string",
            example: "usr_789",
            description: "Your internal user identifier passed at session creation.",
          },
          externalSessionId: {
            type: "string",
            nullable: true,
            example: "your-own-session-id",
          },
          language: {
            type: "string",
            enum: ["ko", "en", "ja", "zh"],
            example: "ko",
          },
          difficulty: { type: "integer", minimum: 1, maximum: 5, example: 4 },
          createdAt: { type: "string", format: "date-time", example: "2026-05-22T09:00:00.000Z" },
          expiresAt: { type: "string", format: "date-time", example: "2026-05-23T09:00:00.000Z" },
          contextLost: {
            type: "boolean",
            example: false,
            description: "`true` when the session is `active` but the server lost the in-memory simulation context (e.g. due to a restart). Clients should re-send any necessary context or restart the session gracefully when this is `true`.",
          },
          requestId: { type: "string", example: "req_a1b2c3d4e5f6" },
        },
      },
      NpcEmotions: {
        type: "object",
        required: ["anger", "trust", "confusion", "interest"],
        description: "Current emotional state of the AI persona (0–100 scale).",
        properties: {
          anger: { type: "number", minimum: 0, maximum: 100, example: 45 },
          trust: { type: "number", minimum: 0, maximum: 100, example: 30 },
          confusion: { type: "number", minimum: 0, maximum: 100, example: 20 },
          interest: { type: "number", minimum: 0, maximum: 100, example: 60 },
        },
      },
      TurnScore: {
        type: "object",
        required: [
          "turnId",
          "turnIndex",
          "clarity",
          "empathy",
          "logic",
          "ownership",
          "actionPlan",
          "total",
          "evaluationMethod",
          "evaluationConfidence",
        ],
        description:
          "Per-turn evaluation scores on a 1–5 scale derived from the research-based 5-point rubric.",
        properties: {
          turnId: { type: "string", example: "ags_abc-1" },
          turnIndex: { type: "integer", example: 0 },
          clarity: {
            type: "number",
            minimum: 1,
            maximum: 5,
            example: 3.5,
            description: "How clearly the user expressed themselves.",
          },
          empathy: {
            type: "number",
            minimum: 1,
            maximum: 5,
            example: 4.0,
            description: "Acknowledgement of the other party's perspective.",
          },
          logic: {
            type: "number",
            minimum: 1,
            maximum: 5,
            example: 3.0,
            description: "Soundness of reasoning and arguments.",
          },
          ownership: {
            type: "number",
            minimum: 1,
            maximum: 5,
            example: 3.5,
            description: "Taking responsibility for the situation.",
          },
          actionPlan: {
            type: "number",
            minimum: 1,
            maximum: 5,
            example: 2.5,
            description: "Concreteness of next-step proposals.",
          },
          total: {
            type: "number",
            minimum: 1,
            maximum: 5,
            example: 3.3,
            description: "Weighted aggregate of the five dimensions.",
          },
          hint: {
            type: "string",
            nullable: true,
            example: "Try to propose a specific follow-up date.",
          },
          evaluationMethod: {
            type: "string",
            enum: ["llm", "rule", "hybrid"],
            example: "llm",
          },
          evaluationConfidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            example: 0.87,
            description: "Model confidence in the evaluation result (0–1).",
          },
        },
      },
      SimulationState: {
        type: "object",
        required: ["version", "stage", "pressureLevel", "npcEmotions", "currentScore", "recentTurnScores", "summary"],
        description:
          "Server-authoritative simulation state updated after every message turn.",
        properties: {
          version: {
            type: "integer",
            example: 3,
            description: "Monotonically increasing version counter; use to detect stale state.",
          },
          stage: {
            type: "string",
            enum: ["intro", "conflict", "negotiation", "escalation", "resolution"],
            example: "conflict",
            description: "Current narrative stage of the scenario.",
          },
          pressureLevel: {
            type: "number",
            minimum: 0,
            maximum: 100,
            example: 62,
            description: "Overall tension in the conversation (0 = calm, 100 = critical).",
          },
          npcEmotions: { $ref: "#/components/schemas/NpcEmotions" },
          currentScore: {
            type: "number",
            minimum: 1,
            maximum: 5,
            example: 3.3,
            description: "Rolling average score across all evaluated turns.",
          },
          recentTurnScores: {
            type: "array",
            items: { $ref: "#/components/schemas/TurnScore" },
            description: "Scores for the last N turns (up to 5).",
          },
          summary: {
            type: "object",
            required: ["totalTurns", "totalIncidents", "averageScore", "maxAnger", "minTrust"],
            properties: {
              totalTurns: { type: "integer", example: 3 },
              totalIncidents: { type: "integer", example: 1 },
              averageScore: { type: "number", example: 3.1 },
              maxAnger: { type: "number", example: 55 },
              minTrust: { type: "number", example: 25 },
            },
          },
        },
      },
      MessageReply: {
        type: "object",
        required: ["text"],
        properties: {
          text: {
            type: "string",
            example: "I'm honestly very disappointed with how this has been handled.",
          },
          emotionLabel: {
            type: "string",
            nullable: true,
            example: "frustrated",
          },
          emotionReason: {
            type: "string",
            nullable: true,
            example: "The user avoided addressing the core issue.",
          },
        },
      },
      MessageResponse: {
        type: "object",
        required: ["id", "sessionId", "turnId", "reply", "simulationState", "turnScore", "usage", "requestId"],
        properties: {
          id: { type: "string", example: "msg_a1b2c3d4e5f6g7h8" },
          sessionId: { type: "string", example: "ags_a1b2c3d4e5f6g7h8i9j0" },
          turnId: { type: "string", example: "ags_a1b2c3d4e5f6g7h8i9j0-1" },
          reply: { $ref: "#/components/schemas/MessageReply" },
          simulationState: {
            nullable: true,
            allOf: [{ $ref: "#/components/schemas/SimulationState" }],
            description: "Updated simulation state after this turn. `null` if simulation is unavailable.",
          },
          turnScore: {
            nullable: true,
            allOf: [{ $ref: "#/components/schemas/TurnScore" }],
            description: "Evaluation scores for this turn. `null` if message was too short to evaluate.",
          },
          usage: {
            type: "object",
            required: ["requestCount", "messageCount", "inputTokens", "outputTokens", "tokensEstimated"],
            description: "Cumulative usage counters for this session, updated after every turn.",
            properties: {
              requestCount: {
                type: "integer",
                example: 3,
                description: "Number of message turns sent so far.",
              },
              messageCount: {
                type: "integer",
                example: 6,
                description: "Total messages exchanged (user + AI). Always `requestCount × 2`.",
              },
              inputTokens: {
                type: "integer",
                example: 1240,
                description: "Cumulative input tokens across all turns.",
              },
              outputTokens: {
                type: "integer",
                example: 870,
                description: "Cumulative output tokens across all turns.",
              },
              tokensEstimated: {
                type: "boolean",
                example: false,
                description: "`true` when token counts were derived from a heuristic length estimate (provider did not return real usage metadata); `false` when counts came from the provider's actual usage data.",
              },
            },
          },
          requestId: { type: "string", example: "req_a1b2c3d4e5f6" },
        },
      },
      WebhookObject: {
        type: "object",
        required: ["id", "url", "events", "isActive", "createdAt"],
        description: "A registered webhook endpoint.",
        properties: {
          id: { type: "string", example: "wh_a1b2c3d4e5f6" },
          url: { type: "string", format: "uri", example: "https://your-server.com/webhooks/agent" },
          events: {
            type: "array",
            items: {
              type: "string",
              enum: ["session.ended", "session.expired", "feedback.completed"],
            },
            example: ["session.ended", "feedback.completed"],
          },
          isActive: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time", example: "2026-05-22T09:00:00.000Z" },
        },
      },
      WebhookCreatedResponse: {
        type: "object",
        required: ["id", "url", "events", "secret", "isActive", "createdAt"],
        description: "Webhook registration response. The `secret` field is returned **once only** — store it securely to verify signatures.",
        properties: {
          id: { type: "string", example: "wh_a1b2c3d4e5f6" },
          url: { type: "string", format: "uri", example: "https://your-server.com/webhooks/agent" },
          events: {
            type: "array",
            items: {
              type: "string",
              enum: ["session.ended", "session.expired", "feedback.completed"],
            },
            example: ["session.ended", "feedback.completed"],
          },
          secret: {
            type: "string",
            example: "whsec_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
            description: "HMAC-SHA256 signing secret. **Shown only at creation** — save it now.",
          },
          isActive: { type: "boolean", example: true },
          createdAt: { type: "string", format: "date-time", example: "2026-05-22T09:00:00.000Z" },
        },
      },
      WebhookEventPayload: {
        type: "object",
        required: ["event", "deliveryId", "timestamp", "data"],
        description: "Payload sent to the registered webhook URL for each event.",
        properties: {
          event: {
            type: "string",
            enum: ["session.ended", "session.expired", "feedback.completed"],
            example: "session.ended",
            description: "The event type that triggered this delivery.",
          },
          deliveryId: {
            type: "string",
            example: "wdl_a1b2c3d4e5f6g7h8i9j0",
            description: "Unique delivery ID. Use for deduplication if your endpoint is called more than once.",
          },
          timestamp: {
            type: "string",
            format: "date-time",
            example: "2026-05-22T09:15:00.000Z",
            description: "ISO 8601 timestamp of the event.",
          },
          data: {
            type: "object",
            required: ["sessionId"],
            description: "Event-specific payload.",
            properties: {
              sessionId: { type: "string", example: "ags_a1b2c3d4e5f6g7h8i9j0" },
              endedAt: {
                type: "string",
                format: "date-time",
                nullable: true,
                description: "Present for `session.ended` events.",
              },
              feedbackReport: {
                type: "object",
                nullable: true,
                description: "Present for `feedback.completed` events. Mirrors the standard feedback object.",
              },
            },
          },
        },
      },
      EndSessionResponse: {
        type: "object",
        required: ["sessionId", "status", "requestId"],
        description: `Response from \`POST /sessions/:id/end\`.

When the session was **active** and is now being ended, \`endedAt\` and \`feedbackStatus\` are always present.
Feedback generation runs asynchronously in the background — poll \`GET /sessions/:id/feedback\` to retrieve the report when ready.
When the session was **already ended** (idempotent call), only \`sessionId\`, \`status\`, and \`requestId\` are returned.`,
        properties: {
          sessionId: { type: "string", example: "ags_a1b2c3d4e5f6g7h8i9j0" },
          status: { type: "string", enum: ["ended"], example: "ended" },
          endedAt: {
            type: "string",
            format: "date-time",
            example: "2026-05-22T09:15:00.000Z",
            description: "ISO 8601 timestamp of when the session was ended. Present when session was just ended; omitted on already-ended replays.",
          },
          feedbackStatus: {
            type: "string",
            enum: ["pending", "completed"],
            example: "pending",
            description: "Current status of the background feedback generation. `pending` means feedback is still being generated. Poll `GET /sessions/:id/feedback` to retrieve the completed report.",
          },
          requestId: { type: "string", example: "req_a1b2c3d4e5f6" },
        },
      },
      FeedbackResponse: {
        type: "object",
        required: ["sessionId", "feedbackStatus", "feedbackReport", "requestId"],
        description: "Response from `GET /sessions/:id/feedback`.",
        properties: {
          sessionId: { type: "string", example: "ags_a1b2c3d4e5f6g7h8i9j0" },
          feedbackStatus: {
            type: "string",
            enum: ["pending", "completed"],
            example: "completed",
            description: "`pending` when feedback generation is still in progress; `completed` when the report is ready.",
          },
          feedbackReport: {
            type: "object",
            nullable: true,
            description: "AI-generated feedback report. `null` when `feedbackStatus` is `pending`.",
            example: {
              overallScore: 3.4,
              dimensions: {
                clarity: 3.5,
                empathy: 4.0,
                logic: 3.0,
                ownership: 3.5,
                actionPlan: 2.5,
              },
              strengths: ["Good empathy demonstrated in turns 1 and 3."],
              improvements: ["Propose concrete next steps more often."],
              summary:
                "The trainee showed solid empathy but could improve on action-oriented communication.",
            },
          },
          requestId: { type: "string", example: "req_a1b2c3d4e5f6" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: `Authentication failed. Possible \`error.code\` values:
| Code | Meaning |
|---|---|
| \`invalid_api_key\` | Missing, malformed, or unrecognised API key |
| \`revoked_api_key\` | Key has been revoked by an admin |
| \`expired_api_key\` | Key's expiry date has passed |`,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            examples: {
              invalid: {
                summary: "Missing or invalid key",
                value: {
                  error: { code: "invalid_api_key", message: "Missing or malformed Authorization header. Expected: Bearer <api_key>", details: null },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
              revoked: {
                summary: "Revoked key",
                value: {
                  error: { code: "revoked_api_key", message: "This API key has been revoked.", details: null },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
              expired: {
                summary: "Expired key",
                value: {
                  error: { code: "expired_api_key", message: "This API key has expired.", details: null },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
            },
          },
        },
      },
      Forbidden: {
        description: `Authorization failed. Possible \`error.code\` values:
| Code | Meaning |
|---|---|
| \`missing_scope\` | Key lacks the required scope for this endpoint |
| \`ip_not_allowed\` | Caller IP is not on the key's IP allowlist |`,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            examples: {
              missingScope: {
                summary: "Missing scope",
                value: {
                  error: { code: "missing_scope", message: "This API key is missing the required scope: sessions:create", details: null },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
              ipNotAllowed: {
                summary: "IP not allowed",
                value: {
                  error: { code: "ip_not_allowed", message: "IP 203.0.113.5 is not in the allowed list for this key.", details: null },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
            },
          },
        },
      },
      NotFound: {
        description: "Requested resource does not exist or is not accessible with this key.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            example: {
              error: { code: "session_not_found", message: "Session not found." },
              requestId: "req_a1b2c3d4e5f6",
            },
          },
        },
      },
      RateLimitExceeded: {
        description: "Per-key rate limit exceeded.",
        headers: {
          "X-RateLimit-Limit": { schema: { type: "integer" }, description: "Max requests per minute." },
          "X-RateLimit-Remaining": { schema: { type: "integer" }, description: "Requests left in current window." },
          "X-RateLimit-Reset": { schema: { type: "integer" }, description: "Epoch when the window resets." },
          "Retry-After": { schema: { type: "integer" }, description: "Seconds until you can retry." },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            example: {
              error: {
                code: "rate_limit_exceeded",
                message: "Rate limit exceeded. See X-RateLimit-* headers for limits.",
              },
              requestId: "req_a1b2c3d4e5f6",
            },
          },
        },
      },
      InternalError: {
        description: "Unexpected server error.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            example: {
              error: { code: "internal_error", message: "Failed to process message." },
              requestId: "req_a1b2c3d4e5f6",
            },
          },
        },
      },
    },
  },
  paths: {
    "/scenarios": {
      get: {
        operationId: "listScenarios",
        summary: "List accessible scenarios",
        description:
          "Returns all scenarios the API key has been granted access to. Soft-deleted scenarios are excluded.",
        tags: ["Scenarios"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "category",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Filter by category slug (e.g. `sales`, `hr`).",
            example: "sales",
          },
          {
            name: "tag",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Filter by tag (e.g. `conflict`).",
            example: "conflict",
          },
        ],
        responses: {
          "200": {
            description: "Scenario list.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["scenarios", "total"],
                  properties: {
                    scenarios: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ScenarioSummary" },
                    },
                    total: { type: "integer", example: 2 },
                  },
                },
                example: {
                  scenarios: [
                    {
                      id: "scenario_001",
                      title: "Difficult Client Meeting",
                      description: "Practice handling an upset enterprise client.",
                      category: "sales",
                      tags: ["conflict", "negotiation"],
                      difficulty: 3,
                      targetTurns: 10,
                      personaCount: 2,
                    },
                  ],
                  total: 1,
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/personas": {
      get: {
        operationId: "listPersonas",
        summary: "List accessible personas",
        description:
          "Returns all personas from scenarios the API key can access. Filter by `scenarioId` to narrow results.",
        tags: ["Personas"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "scenarioId",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Return only personas belonging to this scenario.",
            example: "scenario_001",
          },
        ],
        responses: {
          "200": {
            description: "Persona list.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["personas", "total"],
                  properties: {
                    personas: {
                      type: "array",
                      items: { $ref: "#/components/schemas/PersonaSummary" },
                    },
                    total: { type: "integer", example: 1 },
                  },
                },
                example: {
                  personas: [
                    {
                      id: "persona_001",
                      name: "Kim Jiyeon",
                      scenarioId: "scenario_001",
                      scenarioTitle: "Difficult Client Meeting",
                      role: "Client Manager",
                      mbti: "ENTJ",
                      gender: "female",
                    },
                  ],
                  total: 1,
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/sessions": {
      post: {
        operationId: "createSession",
        summary: "Create a training session",
        description: `Start a new AI role-play training session for one of your users.

**Scopes required:** \`sessions:create\`

**Idempotency:** Supply \`Idempotency-Key\` to safely retry without creating duplicate sessions.

**externalSessionId uniqueness:** If provided, and an *active* session already exists with the same \`externalSessionId\` within your organization, the existing session is returned instead of creating a new one. An ended/expired session with the same ID will produce a new session.`,
        tags: ["Sessions"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
              "Unique key for idempotent creation. Replays the stored response on retry.",
            example: "550e8400-e29b-41d4-a716-446655440000",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["scenarioId", "personaId", "externalUserId"],
                properties: {
                  scenarioId: {
                    type: "string",
                    description: "ID of the scenario to run (must be accessible by this API key).",
                    example: "scenario_001",
                  },
                  personaId: {
                    type: "string",
                    description: "ID of the persona within the scenario.",
                    example: "persona_001",
                  },
                  externalUserId: {
                    type: "string",
                    description: "Your system's user identifier for the trainee.",
                    example: "usr_789",
                  },
                  externalSessionId: {
                    type: "string",
                    description:
                      "Optional stable session ID from your system (used for idempotent lookup).",
                    example: "your-own-session-id",
                  },
                  difficulty: {
                    type: "integer",
                    minimum: 1,
                    maximum: 5,
                    default: 4,
                    description: "AI difficulty level (1 = easiest, 5 = hardest).",
                    example: 3,
                  },
                  language: {
                    type: "string",
                    enum: ["ko", "en", "ja", "zh"],
                    default: "ko",
                    description: "Language for the conversation.",
                    example: "en",
                  },
                  metadata: {
                    type: "object",
                    additionalProperties: true,
                    description:
                      "Arbitrary key-value data attached to the session (max 8 KB). Useful for passing cohort IDs, course IDs, etc.",
                    example: { courseId: "onboarding-2026", cohort: "Q2" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Session created.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Session" },
                example: {
                  sessionId: "ags_a1b2c3d4e5f6g7h8i9j0",
                  status: "active",
                  scenarioId: "scenario_001",
                  personaId: "persona_001",
                  externalUserId: "usr_789",
                  externalSessionId: null,
                  language: "en",
                  difficulty: 3,
                  createdAt: "2026-05-22T09:00:00.000Z",
                  expiresAt: "2026-05-23T09:00:00.000Z",
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
            },
          },
          "200": {
            description:
              "Existing active session returned (when `externalSessionId` matched an active session).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Session" },
              },
            },
          },
          "400": {
            description: "Validation error or `metadata` too large.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
                examples: {
                  validation: {
                    summary: "Missing required field",
                    value: {
                      error: {
                        code: "validation_error",
                        message: "Invalid request body.",
                        details: { fieldErrors: { scenarioId: ["Required"] } },
                      },
                      requestId: "req_a1b2c3d4e5f6",
                    },
                  },
                  metadataTooLarge: {
                    summary: "metadata exceeds 8 KB",
                    value: {
                      error: { code: "metadata_too_large", message: "metadata must be 8KB or less." },
                      requestId: "req_a1b2c3d4e5f6",
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "Idempotency key used with a different request body.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
                example: {
                  error: {
                    code: "idempotency_key_conflict",
                    message: "Idempotency-Key was already used with a different request body.",
                  },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/sessions/{sessionId}": {
      get: {
        operationId: "getSession",
        summary: "Get session details",
        description:
          "Returns the current status and metadata of a session. Sessions expire after 30 minutes of inactivity or 24 hours maximum.",
        tags: ["Sessions"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "ags_a1b2c3d4e5f6g7h8i9j0",
          },
        ],
        responses: {
          "200": {
            description: "Session details.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Session" },
                example: {
                  sessionId: "ags_a1b2c3d4e5f6g7h8i9j0",
                  status: "active",
                  scenarioId: "scenario_001",
                  personaId: "persona_001",
                  externalUserId: "usr_789",
                  externalSessionId: null,
                  language: "en",
                  difficulty: 3,
                  createdAt: "2026-05-22T09:00:00.000Z",
                  expiresAt: "2026-05-23T09:00:00.000Z",
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/sessions/{sessionId}/messages": {
      post: {
        operationId: "sendMessage",
        summary: "Send a message turn",
        description: `Send the trainee's message and receive the AI persona's reply.

**Scopes required:** \`sessions:message\`

**Flow:**
1. User sends a message (max 4,000 characters).
2. The server calls the AI model, evaluates the user's communication quality, and updates the simulation state.
3. The response includes the persona's reply, the per-turn score (\`turnScore\`), and the full updated \`simulationState\`.

**Idempotency:** Supply \`Idempotency-Key\` to safely retry a message send without duplicating turns.

**Errors:** Returns \`400 session_ended\` if the session is no longer active.

**Streaming (SSE):** Set \`Accept: text/event-stream\` to receive the AI reply as a stream of Server-Sent Events instead of waiting for the full response. The stream emits three event types:
- \`event: delta\` — incremental content chunk: \`{"content":"<string>"}\`
- \`event: done\` — final metadata once the full reply has been sent: \`{"emotion","emotionReason","turnId","turnIndex","turnScore","simulationState","usage","requestId"}\`
- \`event: error\` — error payload if something goes wrong mid-stream: \`{"message":"<string>"}\`

The \`usage.tokensEstimated\` field is \`true\` on the streaming path (heuristic counts) and \`false\` when the provider returned real token metadata.

Note: The \`Idempotency-Key\` header is ignored in SSE mode — do not rely on idempotency for streaming requests.

**Example curl (standard JSON):**
\`\`\`bash
curl -X POST https://your-host/api/v1/agent/sessions/ags_xxx/messages \\
  -H "Authorization: Bearer agk_live_xxxx" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"message": "I understand your frustration. Let me explain what happened."}'
\`\`\`

**Example curl (SSE streaming):**
\`\`\`bash
curl -X POST https://your-host/api/v1/agent/sessions/ags_xxx/messages \\
  -H "Authorization: Bearer agk_live_xxxx" \\
  -H "Content-Type: application/json" \\
  -H "Accept: text/event-stream" \\
  -d '{"message": "I understand your frustration. Let me explain what happened."}'
\`\`\``,
        tags: ["Sessions"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "ags_a1b2c3d4e5f6g7h8i9j0",
          },
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description: "Unique key for idempotent message send.",
            example: "550e8400-e29b-41d4-a716-446655440001",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message"],
                properties: {
                  message: {
                    type: "string",
                    minLength: 1,
                    maxLength: 4000,
                    description: "The trainee's message text.",
                    example: "I understand your frustration. Let me explain what happened.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: `AI reply with simulation update.

When \`Accept: text/event-stream\` is **not** set the response is \`application/json\`.

When \`Accept: text/event-stream\` **is** set the response body is a stream of Server-Sent Events (SSE). Each event line has the form \`event: <type>\\ndata: <json>\\n\\n\`. Three event types are emitted:

| Type | Payload | When |
|---|---|---|
| \`delta\` | \`{"content":"<chunk>"}\` | Once per AI token chunk |
| \`done\` | \`{"emotion","emotionReason","turnId","turnIndex","turnScore","simulationState","usage","requestId"}\` | After all chunks sent |
| \`error\` | \`{"message":"<description>"}\` | If generation fails mid-stream |`,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" },
                example: {
                  id: "msg_a1b2c3d4e5f6g7h8",
                  sessionId: "ags_a1b2c3d4e5f6g7h8i9j0",
                  turnId: "ags_a1b2c3d4e5f6g7h8i9j0-1",
                  reply: {
                    text: "I appreciate you saying that, but the delay has already cost us a major client.",
                    emotionLabel: "frustrated",
                    emotionReason: "The apology felt generic without specifics.",
                  },
                  simulationState: {
                    version: 2,
                    stage: "conflict",
                    pressureLevel: 58,
                    npcEmotions: { anger: 50, trust: 30, confusion: 15, interest: 60 },
                    currentScore: 3.1,
                    recentTurnScores: [
                      {
                        turnId: "ags_a1b2c3d4e5f6g7h8i9j0-1",
                        turnIndex: 0,
                        clarity: 3.5,
                        empathy: 4.0,
                        logic: 2.5,
                        ownership: 3.0,
                        actionPlan: 2.5,
                        total: 3.1,
                        hint: "Propose a concrete recovery plan.",
                        evaluationMethod: "llm",
                        evaluationConfidence: 0.91,
                      },
                    ],
                    summary: {
                      totalTurns: 1,
                      totalIncidents: 0,
                      averageScore: 3.1,
                      maxAnger: 50,
                      minTrust: 30,
                    },
                  },
                  turnScore: {
                    turnId: "ags_a1b2c3d4e5f6g7h8i9j0-1",
                    turnIndex: 0,
                    clarity: 3.5,
                    empathy: 4.0,
                    logic: 2.5,
                    ownership: 3.0,
                    actionPlan: 2.5,
                    total: 3.1,
                    hint: "Propose a concrete recovery plan.",
                    evaluationMethod: "llm",
                    evaluationConfidence: 0.91,
                  },
                  usage: { requestCount: 1, messageCount: 2, inputTokens: 420, outputTokens: 310, tokensEstimated: false },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
              "text/event-stream": {
                schema: {
                  type: "string",
                  description: `SSE stream. Lines are in the form \`event: <type>\\ndata: <json>\\n\\n\`.

**Example stream:**
\`\`\`
event: delta
data: {"content":"I appreciate"}

event: delta
data: {"content":" you saying that,"}

event: done
data: {"emotion":"frustrated","emotionReason":"The apology felt generic.","turnId":"ags_xxx-1","turnScore":null,"simulationState":null,"usage":{"requestCount":1,"messageCount":2,"inputTokens":105,"outputTokens":48,"tokensEstimated":true},"requestId":"req_a1b2c3d4e5f6"}
\`\`\``,
                },
              },
            },
          },
          "400": {
            description: "Validation error or session no longer active.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
                examples: {
                  sessionEnded: {
                    summary: "Session ended/expired",
                    value: {
                      error: { code: "session_ended", message: "Session is no longer active." },
                      requestId: "req_a1b2c3d4e5f6",
                    },
                  },
                  validation: {
                    summary: "Message too long",
                    value: {
                      error: {
                        code: "validation_error",
                        message: "Invalid request body.",
                        details: { fieldErrors: { message: ["String must contain at most 4000 character(s)"] } },
                      },
                      requestId: "req_a1b2c3d4e5f6",
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "Idempotency key conflict.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/webhooks": {
      post: {
        operationId: "createWebhook",
        summary: "Register a webhook endpoint",
        description: `Register an HTTPS endpoint to receive push notifications for Agent API lifecycle events.

**Scopes required:** \`webhooks:manage\`

### Supported events
| Event | When it fires |
|---|---|
| \`session.ended\` | A session is ended via \`POST /sessions/:id/end\` |
| \`session.expired\` | A session expires due to inactivity or TTL |
| \`feedback.completed\` | Feedback report generation finishes after a session ends |

### Signature verification
Each delivery includes a \`X-Webhook-Signature\` header in the format \`sha256=<hex>\`.  
Verify it by computing \`HMAC-SHA256(key=<your stored secret>, data=rawBody)\` and comparing in constant time.

\`\`\`js
const crypto = require('crypto');
// secret = the plaintext value returned in \`secret\` at webhook creation (store this securely)
const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
const trusted = req.headers['x-webhook-signature'].replace('sha256=', '');
if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(trusted, 'hex'))) {
  throw new Error('Invalid webhook signature');
}
\`\`\`

> **Important:** The \`secret\` is returned **once only** at creation and is stored server-side in encrypted form (AES-256-GCM). The plaintext is never stored or re-exposed — store it securely on your end as it cannot be retrieved again.`,
        tags: ["Webhooks"],
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url", "events"],
                properties: {
                  url: {
                    type: "string",
                    format: "uri",
                    description: "HTTPS URL that will receive webhook POST requests.",
                    example: "https://your-server.com/webhooks/agent",
                  },
                  events: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: ["session.ended", "session.expired", "feedback.completed"],
                    },
                    minItems: 1,
                    description: "List of event types to subscribe to.",
                    example: ["session.ended", "feedback.completed"],
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Webhook registered. **Save the `secret` now** — it is not stored and cannot be retrieved again.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookCreatedResponse" },
                example: {
                  id: "wh_a1b2c3d4e5f6",
                  url: "https://your-server.com/webhooks/agent",
                  events: ["session.ended", "feedback.completed"],
                  secret: "whsec_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
                  isActive: true,
                  createdAt: "2026-05-22T09:00:00.000Z",
                },
              },
            },
          },
          "400": {
            description: "Validation error.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
                example: {
                  error: { code: "validation_error", message: "Invalid request body.", details: { fieldErrors: { url: ["Invalid url"] } } },
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
      get: {
        operationId: "listWebhooks",
        summary: "List registered webhooks",
        description: "Returns all webhook endpoints registered for this API key. Secrets are never returned.",
        tags: ["Webhooks"],
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "Webhook list.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["webhooks", "total"],
                  properties: {
                    webhooks: {
                      type: "array",
                      items: { $ref: "#/components/schemas/WebhookObject" },
                    },
                    total: { type: "integer", example: 1 },
                  },
                },
                example: {
                  webhooks: [
                    {
                      id: "wh_a1b2c3d4e5f6",
                      url: "https://your-server.com/webhooks/agent",
                      events: ["session.ended", "feedback.completed"],
                      isActive: true,
                      createdAt: "2026-05-22T09:00:00.000Z",
                    },
                  ],
                  total: 1,
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/webhooks/{webhookId}": {
      delete: {
        operationId: "deleteWebhook",
        summary: "Delete a webhook",
        description: "Permanently removes a webhook endpoint. In-flight deliveries already scheduled are not cancelled.",
        tags: ["Webhooks"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "webhookId",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "wh_a1b2c3d4e5f6",
          },
        ],
        responses: {
          "204": { description: "Webhook deleted." },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/sessions/{sessionId}/feedback": {
      get: {
        operationId: "getSessionFeedback",
        summary: "Get feedback report for a session",
        description: `Returns the AI-generated feedback report for an ended session.

**Scopes required:** \`sessions:read\`

Feedback is generated asynchronously after a session ends. Poll this endpoint until \`feedbackStatus\` is \`"completed"\`.

Returns \`404\` with code \`feedback_not_available\` when no feedback job was ever started for this session. This happens for:
- Sessions that are still active (use \`POST /sessions/:id/end\` first)
- Sessions ended without a linked persona run (API-only sessions with no messages)

**Example polling flow:**
\`\`\`bash
# 1. End the session
curl -X POST https://your-host/api/v1/agent/sessions/ags_xxx/end \\
  -H "Authorization: Bearer agk_live_xxxx"
# Response: { "feedbackStatus": "pending", ... }

# 2. Poll until completed (typically within 10–30 seconds)
curl https://your-host/api/v1/agent/sessions/ags_xxx/feedback \\
  -H "Authorization: Bearer agk_live_xxxx"
# Response: { "feedbackStatus": "completed", "feedbackReport": { ... } }
\`\`\``,
        tags: ["Sessions"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "ags_a1b2c3d4e5f6g7h8i9j0",
          },
        ],
        responses: {
          "200": {
            description: "Feedback status and report (when available).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FeedbackResponse" },
                examples: {
                  pending: {
                    summary: "Feedback still generating",
                    value: {
                      sessionId: "ags_a1b2c3d4e5f6g7h8i9j0",
                      feedbackStatus: "pending",
                      feedbackReport: null,
                      requestId: "req_a1b2c3d4e5f6",
                    },
                  },
                  completed: {
                    summary: "Feedback ready",
                    value: {
                      sessionId: "ags_a1b2c3d4e5f6g7h8i9j0",
                      feedbackStatus: "completed",
                      feedbackReport: {
                        overallScore: 3.4,
                        dimensions: {
                          clarity: 3.5,
                          empathy: 4.0,
                          logic: 3.0,
                          ownership: 3.5,
                          actionPlan: 2.5,
                        },
                        strengths: ["Demonstrated genuine empathy in turns 1 and 3."],
                        improvements: ["Propose concrete next steps with specific dates."],
                        summary: "The trainee showed strong empathetic listening but could improve action-oriented responses.",
                      },
                      requestId: "req_a1b2c3d4e5f6",
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/sessions/{sessionId}/end": {
      post: {
        operationId: "endSession",
        summary: "End a session",
        description: `Ends the session immediately and kicks off asynchronous AI feedback generation.

**Scopes required:** \`sessions:end\`

This operation is idempotent: ending an already-ended session returns the stored result without error.

The endpoint returns immediately with \`feedbackStatus: "pending"\`. Feedback generation runs in the background (typically 10–30 seconds). Poll \`GET /sessions/:id/feedback\` to retrieve the report when ready, or subscribe to the \`feedback.completed\` webhook event.

**Example curl:**
\`\`\`bash
curl -X POST https://your-host/api/v1/agent/sessions/ags_xxx/end \\
  -H "Authorization: Bearer agk_live_xxxx" \\
  -H "Content-Type: application/json"
\`\`\``,
        tags: ["Sessions"],
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "ags_a1b2c3d4e5f6g7h8i9j0",
          },
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description: "Unique key for idempotent session end.",
            example: "550e8400-e29b-41d4-a716-446655440002",
          },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {},
                description: "Empty body — no fields required.",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Session ended. Feedback generation started in the background.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EndSessionResponse" },
                example: {
                  sessionId: "ags_a1b2c3d4e5f6g7h8i9j0",
                  status: "ended",
                  endedAt: "2026-05-22T09:15:00.000Z",
                  feedbackStatus: "pending",
                  requestId: "req_a1b2c3d4e5f6",
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "Idempotency key conflict.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimitExceeded" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
  },
  tags: [
    {
      name: "Scenarios",
      description: "Browse scenarios your API key has access to.",
    },
    {
      name: "Personas",
      description: "Browse AI personas available within accessible scenarios.",
    },
    {
      name: "Sessions",
      description: "Create and manage training sessions, send messages, and retrieve feedback.",
    },
    {
      name: "Webhooks",
      description: "Register and manage webhook endpoints for push-based event delivery.",
    },
  ],
};

export default spec;
