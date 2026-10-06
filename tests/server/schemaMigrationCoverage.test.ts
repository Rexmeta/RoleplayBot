/**
 * Schema-migration coverage gate.
 *
 * For every column defined in a Drizzle pgTable() across shared/schema/,
 * this test verifies that server/migrate.ts either:
 *   (a) includes that column in a CREATE TABLE (IF NOT EXISTS) block, OR
 *   (b) has an ALTER TABLE … ADD COLUMN (IF NOT EXISTS) for it, OR
 *   (c) lists it in the criticalColumnPatches array.
 *
 * A gap means the column was added to the Drizzle schema without a
 * corresponding migration step, which produces silent "column does not exist"
 * 500 errors on existing databases when the server first queries that table.
 *
 * ─── Adding a new column ───────────────────────────────────────────────────
 * 1. Add the column to the Drizzle schema as normal.
 * 2. Add an entry to `criticalColumnPatches` in server/migrate.ts, e.g.
 *      { table: 'my_table', column: 'my_column',
 *        sql: `DO $$ BEGIN IF NOT EXISTS (
 *               SELECT 1 FROM information_schema.columns
 *               WHERE table_name='my_table' AND column_name='my_column'
 *             ) THEN ALTER TABLE "my_table" ADD COLUMN "my_column" text; END IF; END $$;` }
 *    OR add an ALTER TABLE … ADD COLUMN IF NOT EXISTS block to runMigrations().
 * 3. This test will then pass again.
 *
 * ─── Acknowledged intentional gaps ────────────────────────────────────────
 * If a column is genuinely unreachable via migrate.ts (e.g. it is inserted
 * in a separate out-of-band script) add "table_name.column_name" to
 * ACKNOWLEDGED_GAPS with an explanatory comment.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const SCHEMA_DIR = join(ROOT, "shared/schema");
const MIGRATE_FILE = join(ROOT, "server/migrate.ts");

// ---------------------------------------------------------------------------
// Acknowledged intentional gaps (add only with a good reason!)
// Format: "table_name.column_name"
// ---------------------------------------------------------------------------
const ACKNOWLEDGED_GAPS = new Set<string>([
  // criticalColumnPatches uses sentinel keys for constraint changes, not real
  // column additions. Those sentinel keys never appear in the Drizzle schema,
  // so they cannot create false failures here. No gaps to acknowledge for now.
]);

// ---------------------------------------------------------------------------
// Column type function names used in Drizzle schema definitions
// ---------------------------------------------------------------------------
const COLUMN_TYPE_RE =
  /:\s*(?:varchar|text|integer|jsonb|boolean|timestamp|doublePrecision|bigint|real|date|uuid|serial)\s*\(\s*"([^"]+)"/g;

// ---------------------------------------------------------------------------
// Parse Drizzle schema files → Map<tableSqlName, Set<columnSqlName>>
// ---------------------------------------------------------------------------
function extractSchemaColumns(content: string): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Find every pgTable("sql_name", { ... }) declaration.
  // We need to identify the column-map object (2nd arg) separately from the
  // optional index-factory 3rd arg so that index("idx_name") calls are not
  // mistaken for column definitions.
  const pgTableRe = /\bpgTable\s*\(\s*"([^"]+)"\s*,\s*\{/g;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = pgTableRe.exec(content)) !== null) {
    const tableName = tableMatch[1];
    // The opening `{` of the column map is the last char of the matched string.
    const colMapOpenPos = tableMatch.index + tableMatch[0].length - 1;

    // Walk forward with brace depth counting to find the matching `}`.
    let depth = 0;
    let pos = colMapOpenPos;
    let colMapClosePos = -1;

    while (pos < content.length) {
      const ch = content[pos];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          colMapClosePos = pos;
          break;
        }
      }
      pos++;
    }

    if (colMapClosePos === -1) continue;

    const colMapContent = content.slice(colMapOpenPos, colMapClosePos + 1);
    const cols: string[] = [];

    // Reset lastIndex because we reuse the regex across iterations.
    COLUMN_TYPE_RE.lastIndex = 0;
    let colMatch: RegExpExecArray | null;

    while ((colMatch = COLUMN_TYPE_RE.exec(colMapContent)) !== null) {
      if (!cols.includes(colMatch[1])) {
        cols.push(colMatch[1]);
      }
    }

    if (cols.length > 0) {
      // Merge with any previously seen columns for the same table name
      // (rare, but possible if a table is referenced in multiple files).
      const existing = result.get(tableName) ?? [];
      const merged = [...existing];
      for (const c of cols) {
        if (!merged.includes(c)) merged.push(c);
      }
      result.set(tableName, merged);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Parse server/migrate.ts → Map<tableSqlName, Set<columnSqlName>>
// Covers:
//   • CREATE TABLE (IF NOT EXISTS) "table" / table ( "col" / col  type … )
//   • ALTER TABLE "table" / table
//       ADD COLUMN (IF NOT EXISTS) "col" / col
//       (multiple ADD COLUMN clauses in one statement are all captured)
//   • criticalColumnPatches entries: { table: 'x', column: 'y' … }
// ---------------------------------------------------------------------------
function extractMigrationCoverage(content: string): Map<string, Set<string>> {
  const coverage = new Map<string, Set<string>>();

  function ensureTable(name: string): Set<string> {
    let s = coverage.get(name);
    if (!s) {
      s = new Set();
      coverage.set(name, s);
    }
    return s;
  }

  // ── SQL type keyword set used for column detection ──
  const SQL_TYPE =
    "(?:varchar|text|integer|jsonb|boolean|timestamp|double\\s*precision|bigint|real|smallint)";

  // ── 1. CREATE TABLE (IF NOT EXISTS) ──────────────────────────────────────
  // Handles both quoted ("table_name") and unquoted (table_name) identifiers.
  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)"?([a-z_]+)"?\s*\(/gi;
  let m: RegExpExecArray | null;

  while ((m = createTableRe.exec(content)) !== null) {
    const tableName = m[1];
    const blockStart = m.index + m[0].length - 1; // position of `(`

    // Walk forward with paren depth to find the matching `)`.
    let depth = 0;
    let p = blockStart;
    let blockEnd = -1;

    while (p < content.length) {
      if (content[p] === "(") depth++;
      else if (content[p] === ")") {
        depth--;
        if (depth === 0) {
          blockEnd = p;
          break;
        }
      }
      p++;
    }

    if (blockEnd === -1) continue;

    const block = content.slice(blockStart, blockEnd + 1);
    const cols = ensureTable(tableName);

    // Column definitions appear as:  "col_name" type  OR  col_name type
    // We anchor with a leading quote or word-boundary to avoid matching
    // constraint names or other identifiers.
    const quotedCol = new RegExp(`"([^"]+)"\\s+${SQL_TYPE}\\b`, "gi");
    const unquotedCol = new RegExp(
      `(?:^|\\n)\\s+"?([a-z_]+)"?\\s+${SQL_TYPE}\\b`,
      "gi"
    );

    let cm: RegExpExecArray | null;
    while ((cm = quotedCol.exec(block)) !== null) cols.add(cm[1]);
    while ((cm = unquotedCol.exec(block)) !== null) cols.add(cm[1]);
  }

  // ── 2. ALTER TABLE … ADD COLUMN (multi-column and unquoted) ─────────────
  // Strategy:
  //   (a) Find each "ALTER TABLE <table>" and record the table name + position.
  //   (b) Collect everything up to the next `;` (end of SQL statement).
  //   (c) Extract all "ADD COLUMN (IF NOT EXISTS) <col>" in that slice.
  //
  // This handles:
  //   • Single-column:  ALTER TABLE t ADD COLUMN "c" type;
  //   • Multi-column:   ALTER TABLE t
  //                       ADD COLUMN IF NOT EXISTS "c1" type,
  //                       ADD COLUMN IF NOT EXISTS "c2" type;
  //   • Unquoted names: ALTER TABLE t ADD COLUMN c type;

  const alterTableRe = /ALTER\s+TABLE\s+"?([a-z_]+)"?/gi;

  while ((m = alterTableRe.exec(content)) !== null) {
    const tableName = m[1];
    const stmtStart = m.index;

    // Find end of statement (next `;` that isn't inside a $$ block or string).
    // For simplicity we just look for the next `;` since ALTER TABLE statements
    // in this file are straightforward.
    const semiPos = content.indexOf(";", stmtStart);
    const stmtEnd = semiPos === -1 ? content.length : semiPos + 1;
    const stmt = content.slice(stmtStart, stmtEnd);

    // Extract all ADD COLUMN clauses within this statement.
    const addColRe = new RegExp(
      `ADD\\s+COLUMN(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+"?([a-z_]+)"?`,
      "gi"
    );
    let ac: RegExpExecArray | null;
    while ((ac = addColRe.exec(stmt)) !== null) {
      ensureTable(tableName).add(ac[1]);
    }
  }

  // ── 3. criticalColumnPatches: { table: 'x', column: 'y' … } ─────────────
  const patchRe =
    /table\s*:\s*['"]([^'"]+)['"]\s*,\s*column\s*:\s*['"]([^'"]+)['"]/g;

  while ((m = patchRe.exec(content)) !== null) {
    ensureTable(m[1]).add(m[2]);
  }

  return coverage;
}

function extractAllSchemaColumns(): Map<string, string[]> {
  const allSchemaColumns = new Map<string, string[]>();
  const schemaFiles = readdirSync(SCHEMA_DIR).filter(
    (f) => f.endsWith(".ts") && f !== "types.ts"
  );

  for (const file of schemaFiles) {
    const content = readFileSync(join(SCHEMA_DIR, file), "utf8");
    const fileColumns = extractSchemaColumns(content);

    for (const [table, columns] of fileColumns) {
      const merged = allSchemaColumns.get(table) ?? [];
      for (const column of columns) {
        if (!merged.includes(column)) merged.push(column);
      }
      allSchemaColumns.set(table, merged);
    }
  }

  return allSchemaColumns;
}

function mergeMigrationCoverage(
  ...sources: Map<string, Set<string>>[]
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const [table, columns] of source) {
      const target = merged.get(table) ?? new Set<string>();
      for (const column of columns) target.add(column);
      merged.set(table, target);
    }
  }
  return merged;
}

const allSchemaColumns = extractAllSchemaColumns();
const startupCoverage = extractMigrationCoverage(
  readFileSync(MIGRATE_FILE, "utf8")
);

// Numbered SQL files are a separate migration channel (for Publish and
// externally managed databases). Keep that coverage separate from startup
// coverage so a numbered migration cannot mask a missing startup patch.
const sqlMigrations = readdirSync(join(ROOT, "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(join(ROOT, "migrations", name), "utf8"))
  .join("\n");
const numberedMigrationCoverage = extractMigrationCoverage(sqlMigrations);
const combinedCoverage = mergeMigrationCoverage(
  startupCoverage,
  numberedMigrationCoverage
);

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
describe("Schema-migration coverage", () => {
  it(
    "every Drizzle schema column has coverage in startup or numbered SQL migrations",
    () => {
      // Find gaps
      const gaps: string[] = [];

      for (const [table, cols] of allSchemaColumns) {
        const covered = combinedCoverage.get(table);

        for (const col of cols) {
          const key = `${table}.${col}`;
          if (ACKNOWLEDGED_GAPS.has(key)) continue;

          if (!covered || !covered.has(col)) {
            gaps.push(key);
          }
        }
      }

      if (gaps.length > 0) {
        const lines = [
          "",
          `Found ${gaps.length} Drizzle schema column(s) with no coverage in startup or numbered SQL migrations:`,
          "",
          ...gaps.map((g) => `  ✗ ${g}`),
          "",
          "Add a startup patch in server/migrate.ts or a numbered SQL migration.",
          "",
        ].join("\n");

        expect.fail(lines);
      }
    }
  );

  it(
    "startup migration covers every persona_runs column used by full-row reads",
    () => {
      const missingStartupColumns = (allSchemaColumns.get("persona_runs") ?? [])
        .filter((column) => !startupCoverage.get("persona_runs")?.has(column));

      expect(
        missingStartupColumns,
        `persona_runs columns missing from server/migrate.ts startup coverage:\n${missingStartupColumns
          .map((column) => `  ✗ persona_runs.${column}`)
          .join("\n")}`
      ).toEqual([]);
    }
  );
});
