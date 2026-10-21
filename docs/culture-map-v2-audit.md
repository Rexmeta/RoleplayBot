# Country profile registration audit

## Scope and existing implementation

This delivery addresses the request to add country-named profiles using the
uploaded data. It extends the existing Culture Map; it does not rebuild it.
The broader attached v2 brief is a roadmap, not a claim that every described
comparison/import UI/simulation feature has been completed in this data import.

Existing CRUD, permission checks, immutable versions, per-Actor selection,
intensity/overrides, scenario import/export and separate text/voice prompt layers
are reused. Persona tables and CRUD, historical scenarios and assessment
scoring are not changed.

## Source data and registration

- Canonical data: `server/data/culture-map/roleplayx-2026.json`, copied byte-for-byte
  from the uploaded JSON. It contains 47 country/region profiles.
- Uploaded CSV copies are identical. Their 47 rows match JSON names, regions,
  all scores, confidence, notes, profile type and review status. The XLSX data
  worksheet matches CSV; its other worksheet contains documentation.
- Each baseline's profile name and country field are exactly `countryNameKo`.
- Preserve every original profile field in `origin.originalProfile`, including
  its source ID, `schemaVersion`, string `profileVersion`, `profileType`,
  confidence, original dimensions, context, notes, source IDs, individuation
  rule and review status. Source framework, methodology and notice remain
  available in provenance and the canonical JSON.
- `editorial_estimate` / `draft_requires_validation` is retained. Confidence
  describes interpretation, not statistical certainty. References to WVS,
  GLOBE and Gallup do NOT mean these scores were measured or validated there.
- Data source version `2026.1` is distinct from the existing numeric database
  revision (`version=1` at creation).
- No new tables/migrations. Optional JSONB provenance is backward-compatible.

## Axis conversion

Seven uploaded axes agree with the app's existing low/high endpoints.
**Persuading is reversed**: the source is applications→principles, whereas the
existing app is principles→applications. Only the applied score is converted:

```text
app.persuading = 100 - source.persuading
all other app scores = source scores
```

Example: United States original persuading **20** becomes app **80**, which
still means applications-first. The original 20 is preserved, displayed in
details, and never overwritten. Source endpoint definitions are validated so a
future file with changed semantics fails rather than silently misapplying data.

## Idempotence, access and immutability

- Startup runs a seed after table migrations.
- UUID identity is deterministic from countryCode + source profileVersion +
  profileType, namespaced to the system dataset.
- Insert-only transaction writes profile + initial version together.
- Reruns skip existing UUIDs; no user/custom row is updated, no edited row
  is reset, and no soft-deleted row is resurrected.
- Existing module has no tenant column. Its existing global shared/private
  permission model is preserved; no new cross-tenant query path is added.
- All baselines are shared/readable within that model and system-owned.
  Even admins cannot update/delete originals through the API. Duplicate creates
  a private, independently editable custom profile and opens it for editing.
- Original provenance is retained when cloning and binding Actor snapshots,
  so scenario import/export and source deletion retain evidence level.
- Runtime adds a fixed unvalidated-estimate caution, not instructions copied
  from source text. OFF/zero-emphasis behavior remains unchanged.

## Changed files

- `server/data/culture-map/roleplayx-2026.json`
- `server/services/cultureMap/dataset.ts`, `seed.ts`, `service.ts`, `prompt.ts`
- `server/index.ts`
- `shared/cultureMap.ts`
- `client/src/components/admin/cultureMap/CultureOriginNotice.tsx`
- `client/src/components/admin/cultureMap/CultureProfilesManager.tsx`
- `client/src/components/admin/cultureMap/ActorCultureEditor.tsx`
- `tests/server/cultureMap.test.ts`, `tests/client/cultureMap.test.tsx`
- `docs/culture-map.md`, this audit, `replit.md`

## Further roadmap items (not implemented in this import)

The supplied brief additionally describes multi-country comparison charts,
region/confidence filters, admin JSON/CSV import/export UI, generated behavioral
examples, review workflows and controlled behavioral simulations. These are
separate extensions. Actual paid-provider behavior and signed-in browser
interactions must not be claimed as validated by unit tests.

## Verification results

- `npm run check -- --pretty false`: passed.
- `npm run build`: passed (bundle-size warning only).
- `npx vitest run --maxWorkers=2`: **109 files, 2,185 tests passed**.
- PostgreSQL temporary-table tests verify all 47 rows and first versions,
  insert-only reruns, preservation of a same-named custom profile, simulated
  operator edits/deletes, transaction rollback, baseline write protection,
  independent clones and provenance-frozen Actor snapshots.
- Client tests verify admin read-only originals, editable private clones,
  review warnings, data versions and the displayed scale conversion.
- Development startup: **47 inserted, 0 preserved, 47 total**.
  A subsequent DB read verified every country name, applied dimensions and
  original source identity. Existing custom-profile checksum was unchanged.
- Preview rendered the sign-in screen. Signed-in UI appearance and actual
  AI-provider/voice behavior were not verified by that capture.
- No production publish or production data operation was performed.
