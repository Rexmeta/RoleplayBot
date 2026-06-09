/**
 * README sync check — ensures replit.md stays current as the codebase evolves.
 *
 * When you add a new database table or a new schema module, this test will fail
 * until replit.md is updated to mention it.  That is intentional: the failure
 * is your reminder to document the change.
 *
 * HOW TO FIX A FAILING TEST
 * --------------------------
 * 1. Open replit.md.
 * 2. Find the "Data Storage / Schema modules" section.
 * 3. Add the missing table name(s) or schema file name to the relevant line.
 * 4. Re-run `npx vitest run tests/readmeSyncCheck.test.ts` to confirm it passes.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const README_PATH = path.resolve('replit.md');
const SCHEMA_DIR = path.resolve('shared/schema');

function readReadme(): string {
  return fs.readFileSync(README_PATH, 'utf-8');
}

/**
 * Parse every `pgTable("table_name", …)` call across all schema files and
 * return the set of table names found.
 */
function extractTableNames(): string[] {
  const schemaFiles = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('index'));

  const names: string[] = [];
  const tablePattern = /pgTable\(\s*["']([^"']+)["']/g;

  for (const file of schemaFiles) {
    const src = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf-8');
    let match: RegExpExecArray | null;
    while ((match = tablePattern.exec(src)) !== null) {
      names.push(match[1]);
    }
  }

  return [...new Set(names)].sort();
}

/**
 * Return the list of schema module filenames (without extension) that should
 * be documented.  We skip helper/index files that carry no table definitions.
 */
function extractSchemaModules(): string[] {
  const skip = new Set(['index', 'types']);
  return fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.ts') && !skip.has(f.replace('.ts', '')))
    .map((f) => f); // keep extension so the assertion reads "settings.ts" etc.
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('replit.md sync checks', () => {
  it('mentions every database table defined in shared/schema/', () => {
    const readme = readReadme();
    const tables = extractTableNames();

    const missing = tables.filter((t) => !readme.includes(t));

    expect(missing, [
      '',
      'The following table(s) are defined in shared/schema/ but not mentioned in replit.md.',
      'Add them to the "Data Storage / Schema modules" section and re-run this test.',
      '',
      '  ' + missing.join('\n  '),
      '',
    ].join('\n')).toEqual([]);
  });

  it('mentions every schema module file listed in shared/schema/', () => {
    const readme = readReadme();
    const modules = extractSchemaModules();

    const missing = modules.filter((m) => !readme.includes(m));

    expect(missing, [
      '',
      'The following schema module file(s) are not mentioned in replit.md.',
      'Add them to the "Data Storage / Schema modules" section and re-run this test.',
      '',
      '  ' + missing.join('\n  '),
      '',
    ].join('\n')).toEqual([]);
  });
});
