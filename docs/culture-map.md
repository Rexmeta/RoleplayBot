# Culture Map

## Authoring and boundaries

The Culture Map tab is immediately after Scenario in `/admin-management`.
All profiles are **user-defined**, not verified national averages. No national
scores are seeded. Initial editor values of 50 are neutral authoring controls,
not evidence about a country. Source titles, URLs, page/section locators and
notes are versioned alongside the eight dimensions.

Each dimension is a continuum from 0 to 100. The eight endpoints are defined
in `shared/cultureMap.ts` and shown in the editor. They describe situational
behavioral tendencies, never fixed individual personality, capability or
nationality stereotypes. Intensity expresses instruction emphasis, not a
deterministic chance of behavior.

Operators create private profiles, edit/delete their own, and read/copy
administrator-shared profiles. Administrators manage all profiles and sharing.
Unauthorized private IDs return 404; shared write attempts return 403.
Updates and deletes require the current `expectedVersion`; stale requests
return 409. Editing creates a new immutable version. Deletion is soft and
preserves prior versions and saved Actor snapshots.

## Scenario integration

The Actor option is OFF by default. Enabling it requires a profile and an exact
version; intensity and dimension overrides are optional adjustments. Reusing a
Persona template creates distinct Actor IDs without changing the Persona.
Scenario save resolves an accessible server profile version and freezes its
name, country/region, sources, effective dimensions and intensity in the
Actor's `culture` property. Client-provided snapshot values do not override
server version content. An unchanged saved snapshot remains valid after its
source is deleted or access changes.

Published versions, scenario duplication, and JSON/ZIP exports preserve Actor
culture. Import revalidates the settings and server profile access; references
to unavailable profiles are an explicit save error, not a silent fallback.
No Persona table, Persona CRUD or historical report is migrated.

## Execution

New culture-enabled native runs capture their scenario, raw runtime Persona
profiles and rubric context once. Already published runs use their published
snapshots. Legacy/OFF native runs do not acquire cultural settings added to live
scenario content later. Source profile edits do not mutate saved scenarios or
existing runs.

Text and streaming providers (Gemini, OpenAI/OpenRouter and custom) and
Gemini/OpenAI realtime voice use a separate snapshot-only culture layer.
Each layer names the Actor ID; join mode includes independent layers and
replace mode uses only the active Actor. The voice layer survives reconnect
greeting removal and Actor-specific prompt changes. Source free text is not
inserted as instructions. Malformed active snapshots fail explicitly.
TTS uses the same generated text; no cultural voice/accent synthesis is added.
Agent API culture sessions must bind a durable internal run and reuse its
snapshot for subsequent response/feedback context.

OFF produces no additional prompt text. Assessment formulas and rubric weights
are unchanged; cultural dimensions do not directly add or subtract points.

## Database and rollout

`migrations/0020_culture_map.sql` creates `culture_profiles` and
`culture_profile_versions`. Matching idempotent startup SQL is in
`server/migrate.ts`. Existing Persona/Scenario table layouts are unchanged:
the optional Actor property uses the existing scenario `personas` JSONB.

No production publish, national data import or historical migration is part
of this change. Run the normal numbered migrations in environments that use
that migration channel; startup also ensures both new tables.

## Verification

- `npm run check -- --pretty false`
- `npm run build`
- `npx vitest run`
- Focused Culture Map tests cover authenticated CRUD, ownership, sharing,
  optimistic concurrency, immutable versions, soft deletion, server-resolved
  Actor snapshots, source changes/deletion, OFF prompt parity, reconnect,
  distinct Actors using the same Persona, historical version selection,
  portable export/import and editor CRUD requests.
- PostgreSQL tests use connection-local TEMP tables only; no public data is
  changed by those tests. They require the development database environment.
- Mocked prompts and UI tests are not evidence of actual provider behavior,
  culture representation quality, voice intelligibility or device performance.
  Signed-in visual and real-provider checks must be reported separately.

### Results from this implementation

- TypeScript check and production build passed.
- `npx vitest run --maxWorkers=2`: **109 files / 2,179 tests passed**.
- Default parallelism: 2,177 passed; two existing video-generation tests
  exceeded the default five-second limit. Lower concurrency passed those same
  tests without changing video generation code or relaxing assertions.
- Application workflow restarted successfully; startup confirmed creation of
  both Culture Map tables. The live development management API returned 401
  without authentication, as expected.
- Preview capture showed the sign-in screen. Signed-in Culture Map browser
  interactions and actual paid AI/voice sessions were not visually or manually
  verified. Client interaction tests and mocked voice/runtime tests are not
  claimed as substitutes for those checks.
- No production publish was performed.

## Changed-file inventory

New implementation:

- `shared/cultureMap.ts`
- `shared/schema/cultureMap.ts`
- `migrations/0020_culture_map.sql`
- `server/routes/cultureMap.ts`
- `server/services/cultureMap/service.ts`
- `server/services/cultureMap/prompt.ts`
- `server/services/cultureMap/runSnapshot.ts`
- `client/src/components/admin/cultureMap/CultureProfilesManager.tsx`
- `client/src/components/admin/cultureMap/ActorCultureEditor.tsx`
- `client/src/components/admin/cultureMap/actorIdentity.ts`

Existing integration points:

- `shared/schema/index.ts`
- `shared/schema/scenarios.ts`
- `server/migrate.ts`
- `server/routes.ts`
- `server/routes/adminScenarios.ts`
- `server/routes/conversations.ts`
- `server/routes/agentApi.ts`
- `server/services/fileManager.ts`
- `server/services/runtimeScenario.ts`
- `server/services/voice/systemPromptBuilder.ts`
- `server/services/providers/optimizedGeminiProvider.ts`
- `server/services/providers/openaiProvider.ts`
- `server/services/providers/customProvider.ts`
- `client/src/pages/admin-management.tsx`
- `client/src/components/admin/ScenarioManager.tsx`
- `client/src/lib/scenario-system.ts`
- `client/src/lib/scenarioExport.ts`

Verification/support changes:

- `tests/server/cultureMap.test.ts`
- `tests/server/cultureRunSnapshot.test.ts`
- `tests/server/culturePersonaIsolation.test.ts`
- `tests/client/cultureMap.test.tsx`
- `tests/client/scenarioExport.test.ts`
- `tests/server/schemaMigrationCoverage.test.ts` (recognizes UUID SQL types)
- `tests/server/staleApiRoutes.test.ts` (registers the new route file)
- `tests/server/realtimeVoiceService.test.ts` (isolates provider ordering from
  unrelated ledger database latency)
- `server/services/realtimeVoiceService.ts` (preserves the required scenario ID
  when merging an existing ledger binding; fixes the pre-existing type error)
- `replit.md`
- `docs/culture-map.md`
