import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { hardenParser, patchInstalled, guard } = require('../../scripts/patch-picomatch.cjs');
const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
const copies = Object.keys(lock.packages).filter(entry => entry.endsWith('node_modules/picomatch'));

describe('picomatch install-time protection', () => {
  it('patches clean direct and nested copies, allows omissions and is repeatable', () => {
    const root = mkdtempSync(join(tmpdir(), 'picomatch-security-'));
    try {
      writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
        packages: { ...lock.packages, 'node_modules/omitted/node_modules/picomatch': {} },
      }));
      for (const entry of copies) {
        const destination = join(root, entry);
        mkdirSync(join(destination, 'lib'), { recursive: true });
        writeFileSync(join(destination, 'package.json'), readFileSync(resolve(entry, 'package.json')));
        const original = readFileSync(resolve(entry, 'lib/parse.js'), 'utf8').replace(guard, '');
        writeFileSync(join(destination, 'lib/parse.js'), original);
      }
      patchInstalled(root);
      patchInstalled(root);
      for (const entry of copies) {
        expect(readFileSync(join(root, entry, 'lib/parse.js'), 'utf8')).toContain(guard);
      }
      writeFileSync(join(root, copies[0], 'lib/parse.js'), 'unexpected parser');
      expect(() => patchInstalled(root)).toThrow('Unexpected picomatch');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.each(copies)('picomatch security: %s', entry => {
  const directory = resolve(entry);
  const pm = require(directory);
  const { version } = require(`${directory}/package.json`);
  const source = readFileSync(`${directory}/lib/parse.js`, 'utf8');

  it('applies the checked patch idempotently and rejects unexpected code', () => {
    expect(source).toContain(guard);
    expect(hardenParser(source, version)).toBe(source);
    const original = source.replace(guard, '');
    expect(hardenParser(original, version)).toBe(source);
    expect(() => hardenParser(original + '\n// unexpected', version)).toThrow('Unexpected picomatch');
    expect(() => hardenParser(source, '0.0.0')).toThrow('Unreviewed picomatch');
  });

  it('rejects adversarial repeated wildcards without blocking the event loop', () => {
    // Vitest's timeout cannot interrupt a synchronous regex. A child-process
    // timeout can, so a regression cannot hang the entire test runner.
    const result = execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const pm = require(${JSON.stringify(directory)});
      for (const pattern of ['+(*)', '+(*a)', '*(*a)', '+(*a|b)', '+(*?a)', '+(@(*a))']) {
        for (const options of [{}, { maxExtglobRecursion: false }, { capture: true }]) {
          assert.equal(pm.isMatch('a'.repeat(100) + '!', pattern, options), false, pattern);
          assert.equal(pm.isMatch(pattern, pattern, options), true, pattern);
        }
      }
      console.log('safe');
    `], { timeout: 3000, encoding: 'utf8' });
    expect(result.trim()).toBe('safe');
  });

  it('preserves ordinary matching and safe extglobs', () => {
    expect(pm('**/*.{ts,tsx}')('client/src/App.tsx')).toBe(true);
    expect(pm('**/*.{ts,tsx}')('client/src/App.js')).toBe(false);
    expect(pm.isMatch('.hidden.ts', '*.ts')).toBe(false);
    expect(pm.isMatch('.hidden.ts', '*.ts', { dot: true })).toBe(true);
    expect(pm.isMatch('ababa', '+(a|b)')).toBe(true);
    expect(pm.isMatch('abab', '+(ab)')).toBe(true);
    expect(pm.isMatch('aaaa', '+(*(a))')).toBe(false);
    expect(pm.isMatch('+(*(a))', '+(*(a))')).toBe(true);
    expect(pm.isMatch('***', '+([*])')).toBe(true);
    expect(pm.isMatch('***', '+(\\*)')).toBe(true);
    expect(pm.isMatch('+("*")', '+("*")')).toBe(true);
    expect(pm.isMatch('file.ts', '!(*.js)')).toBe(true);
    expect(pm.isMatch('file.js', '!(*.js)')).toBe(false);
  });

  it('blocks wildcards hidden behind unmatched or disabled character classes', () => {
    const result = execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const pm = require(${JSON.stringify(directory)});
      for (const pattern of ['+([*a)', '*([*a)', '+([*a|b)']) {
        for (const options of [{}, { maxExtglobRecursion: false }, { nobracket: true }]) {
          assert.equal(pm.isMatch('[a'.repeat(100) + '!', pattern, options), false, pattern);
          assert.equal(pm.isMatch(pattern, pattern, options), true, pattern);
        }
      }
      for (const pattern of ['+([*a])', '*([*a])']) {
        const options = { nobracket: true };
        assert.equal(pm.isMatch('[a]'.repeat(100) + '!', pattern, options), false, pattern);
        assert.equal(pm.isMatch(pattern, pattern, options), true, pattern);
      }
      // Valid classes remain classes with the default options.
      assert.equal(pm.isMatch('a*a', '+([*a])'), true);
      for (const pattern of ['+([]"*]a*)', '+([^]"*]a*)', '+([[:alpha:]]*a)', '+(*(?=a)a)']) {
        for (const options of [{}, { maxExtglobRecursion: false }, { nobracket: true }]) {
          assert.equal(pm.isMatch(']a'.repeat(100) + '/', pattern, options), false, pattern);
          assert.equal(pm.isMatch(pattern, pattern, options), true, pattern);
        }
      }
      console.log('safe');
    `], { timeout: 3000, encoding: 'utf8' });
    expect(result.trim()).toBe('safe');
  });
});
