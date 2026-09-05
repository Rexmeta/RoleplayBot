# ContentX → RoleplayX Integration Guide (v1)

## Purpose and ownership

ContentX is the canonical authoring and publishing source for assessment content. RoleplayX validates a published package, stores an immutable runtime copy, and executes it through the existing scenario, persona, evaluation, and feedback pipeline.

```text
ContentX authoring
  → AssessmentScenarioPackage v1
  → RoleplayX validation/import boundary
  → existing Scenario registry + published snapshot
  → existing assessment runtime
  → existing evaluation and feedback
```

This is a one-way publishing boundary. RoleplayX does not edit ContentX, duplicate its authoring database, or introduce a second scenario runtime model.

## Reference implementation

| Concern | Source |
|---|---|
| Strict v1 Zod contract | `shared/schema/contentx.ts` |
| Deterministic contract-to-runtime adapter | `shared/contentxAdapter.ts` |
| Authenticated import routes | `server/routes/contentImports.ts` |
| Atomic persistence and snapshots | `server/storage/contentxImports.ts` |
| Runtime snapshot resolution | `server/services/runtimeScenario.ts` |
| Canonical demo package | `tests/fixtures/contentx/team-leader-promotion-assessment.v1.json` |
| End-to-end contract test | `tests/server/contentxDemoIntegration.test.ts` |

## AssessmentScenarioPackage v1 contract

The top-level object is strict: unknown fields are rejected.

| Field | Requirement |
|---|---|
| `schemaVersion` | Exactly `"1.0"` |
| `packageKey` | Lowercase ContentX key |
| `version` | Semantic version such as `1.0.0` |
| `publishedAt` | ISO-8601 date-time including an offset |
| `metadata` | Title, description, locale, and tags |
| `competencies` | Unique competency keys with names and descriptions |
| `scenarios` | One or more complete executable scenarios |
| `provenance` | `source: "ContentX"`, stable `sourcePackageId`, author (optional), and publisher hash |

Every scenario supplies:

- identity, title, description, locale, competency references, and difficulty (1–10);
- context with situation, timeline, stakes, and player role;
- objectives and all four success levels;
- one or more personas, with exactly one primary persona;
- interaction guidance through recommended flow, constraints, optional flow stages, persona switches, and simulation policy;
- evaluation dimensions whose weights total 10, plus pass rules;
- target duration, target turns, and minimum valid turns;
- optional termination, analytics, and difficulty profiles.

Relationship validation rejects duplicate keys, unknown competencies, broken flow links, unknown persona-switch targets, invalid dimension references, and `minValidTurns > targetTurns`.

### Persona references

`personaRef` is resolved into an immutable runtime profile during import. v1 accepts the existing MBTI profiles:

`istj`, `isfj`, `infj`, `intj`, `istp`, `isfp`, `infp`, `intp`, `estp`, `esfp`, `enfp`, `entp`, `estj`, `esfj`, `enfj`, and `entj`, with or without the `.json` suffix.

An unresolved persona reference causes import to fail atomically.

## Field mapping

The adapter reuses existing RoleplayX models.

| ContentX | RoleplayX |
|---|---|
| scenario title/description/locale | `scenarios.title`, `description`, `sourceLocale` |
| competency keys | `scenarios.skills` |
| context and player role | `scenarios.context` |
| objectives and success criteria | matching scenario fields |
| personas | `scenarios.personas` |
| flow stages | `scenarios.flowGraph` |
| persona switches | `scenarios.personaSwitchRules` |
| constraints | `scenarios.playerConstraints` |
| evaluation dimensions | approved criteria set + dimensions |
| evaluation pass rules | `scenarios.evaluationHarness` |
| difficulty | `difficulty` and `difficultyProfile` |
| termination/simulation/analytics | existing matching scenario fields |
| duration/turn limits | existing target/minimum fields |
| source identity/version | ContentX provenance columns on `scenarios` |

Contract dimension weights use a total of 10; persisted criteria dimensions use the runtime's 100-point weight scale. Adapter-generated identities are deterministic for a source package, version, scenario, persona, and dimension. Persistence creates tenant-local database IDs and returns them to the caller.

The request's trusted `categoryId` is the persistence target. `categoryKey` remains descriptive v1 package metadata and is not used to select a database category.

## API

Both endpoints require the existing authenticated session and an `admin` or `operator` role. They use JSON bodies:

```json
{
  "organizationId": "11111111-1111-4111-8111-111111111111",
  "categoryId": "22222222-2222-4222-8222-222222222222",
  "package": {
    "schemaVersion": "1.0",
    "packageKey": "team-leader-promotion-assessment",
    "version": "1.0.0"
  }
}
```

The abbreviated package above is illustrative only. Use the complete canonical fixture for an executable request.

### Validate without writing

```http
POST /api/content/import/validate
Content-Type: application/json
Cookie: <existing RoleplayX session>
```

Success (`200`):

```json
{
  "valid": true,
  "target": {
    "organizationId": "11111111-1111-4111-8111-111111111111",
    "categoryId": "22222222-2222-4222-8222-222222222222"
  },
  "package": {
    "sourcePackageId": "contentx-team-leader-promotion",
    "packageKey": "team-leader-promotion-assessment",
    "contentVersion": "1.0.0",
    "scenarioCount": 3
  },
  "diagnostics": []
}
```

Validation performs contract mapping and trusted-target checks but creates no records.

### Import

```http
POST /api/content/import
Content-Type: application/json
Cookie: <existing RoleplayX session>
```

First import returns `201`:

```json
{
  "package": {
    "sourcePackageId": "contentx-team-leader-promotion",
    "contentVersion": "1.0.0",
    "created": true
  },
  "scenarios": [{
    "sourceScenarioKey": "low-performer-coaching",
    "scenario": { "id": "<scenario-id>", "created": true },
    "criteriaSet": { "id": "<criteria-id>", "created": true },
    "publishedVersion": { "id": "<version-id>", "created": true }
  }]
}
```

An exact retry returns the same identifiers with `200` and `created: false`.

## Error behavior

| Status | Code | Meaning |
|---|---|---|
| `400` | `CONTENTX_INVALID_PACKAGE` | Contract validation failed; `details.diagnostics` identifies paths |
| `400` | `CONTENTX_TARGET_INACTIVE` | Organization or category is inactive |
| `400` | `CONTENTX_TARGET_MISMATCH` | Category is not in the requested organization |
| `401` | existing auth response | No authenticated session |
| `403` | existing role response | User is not an operator/admin |
| `403` | `CONTENTX_TARGET_FORBIDDEN` | Operator cannot manage the trusted target |
| `404` | `CONTENTX_TARGET_NOT_FOUND` | Organization or category does not exist |
| `409` | `CONTENTX_VERSION_CONFLICT` | Same immutable source version was previously imported with different content, scenario keys, or category |
| `500` | `CONTENTX_VALIDATION_FAILED` / `CONTENTX_IMPORT_FAILED` | Unexpected internal failure; internal details are not returned |

## Tenant security

- The API uses existing RoleplayX authentication and role middleware; it introduces no ContentX credential store.
- Organization and category IDs are parsed as UUIDs and resolved from RoleplayX records.
- The category must belong to the requested active organization.
- Operators must be assigned to the category, organization, or company, or pass the existing category-management authorization check.
- Admins are system-wide trusted administrators under the existing RoleplayX authorization model.
- Package fields are validated by strict nested Zod schemas before persistence.
- The complete import is a single database transaction; a persona resolution or write failure leaves no partial package.

## Immutable versions and historical runs

The immutable identity is:

```text
organizationId + provenance.sourcePackageId + package.version
```

Importing `1.1.0` after `1.0.0` creates independently addressable scenarios, criteria, and published snapshots. It does not update the `1.0.0` rows.

At run start, the normal conversation creation path binds the latest published `scenario_versions` record for the selected scenario. The run stores:

- `scenarioVersionId`;
- the scenario content snapshot;
- the evaluation harness snapshot;
- the embedded evaluation criteria/dimensions snapshot;
- an embedded runtime profile for each persona.

Runtime resolution treats this run snapshot as authoritative. Later imports or live edits cannot change the scenario, persona behavior, rubric, or harness used by an existing run. Imported scenarios fail closed if the required published snapshot is unavailable.

## Idempotency

The API does not accept a separate `Idempotency-Key` header in v1. The package identity above is the idempotency key, and RoleplayX calculates a canonical SHA-256 digest from package content instead of trusting `provenance.contentHash`.

An exact retry must use:

- the same organization;
- the same source package ID and semantic version;
- the same scenario key set and canonical content;
- the same target category.

Concurrent retries are serialized with a transaction-scoped advisory lock and backed by a unique database identity index. Reusing a published version for changed content returns `409`; publish a new semantic version instead.

## End-to-end example

1. Start with `tests/fixtures/contentx/team-leader-promotion-assessment.v1.json`.
2. Replace only the request's organization/category UUIDs with an authorized RoleplayX target.
3. Call `/api/content/import/validate` and resolve all diagnostics.
4. Call `/api/content/import`; retain the returned scenario and published-version IDs.
5. Retry the same request to confirm `200` and `created: false`.
6. Publish changed content as `1.1.0`, with a new publication time and publisher hash.
7. Import `1.1.0`; expect new scenario/version IDs.
8. Start the normal RoleplayX assessment flow with a returned scenario ID. No ContentX-specific run endpoint is required.
9. Existing runs continue using their bound version snapshots; new runs for the newer imported scenario use its newer snapshot.

The integration test automates this sequence and also checks unauthenticated, ordinary-user, and cross-tenant rejection.

## Known v1 limitations

- Publishing is one-way; there is no bidirectional sync.
- Runtime feedback is not sent to ContentX automatically.
- `categoryKey` does not auto-create or resolve categories; callers provide an authorized RoleplayX category UUID.
- Package-level partial import and per-scenario rollback are not supported.
- Existing imported versions cannot be mutated or moved to another category.
- Persona references are limited to the existing RoleplayX MBTI profile set.
- There is no ContentX-specific UI or production deployment guide.
- Package idempotency is body/version based; there is no standalone idempotency header.
