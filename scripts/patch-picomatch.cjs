'use strict';

// GHSA-fc5q-39xc-vjpf has no published fix as of 2026-11-18.
// Apply a fail-closed local mitigation to every npm-locked copy, including
// transitive build/test dependencies. See docs/security/picomatch.md.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const hashes = {
  '2.3.2': '3a91656f440069aa8f8e15c9d695b9f6b2209df1eab2be8127c72cbcca45ff5f',
  '4.0.4': 'ce57c04e04994b83e2ca566170fa192e6fe19d710bea6da00ce2f76d01c0dea4',
  '4.0.7': '4e1e05447668aa1e94366c5516a2bcd8f5fff800cc92b1d0cd7d77703b8618c4',
};

const anchor = 'const analyzeRepeatedExtglob = (body, options) => {\n';
const guard = `  // GHSA-fc5q-39xc-vjpf: never nest an unbounded wildcard in a repeat.
  // Keep this independent of maxExtglobRecursion, including its false setting.
  let escaped = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\\\') { escaped = true; continue; }
    // Only skip simple, unambiguous complete classes. Never infer quote or
    // complex class state: malformed/POSIX/initial-] classes differ by options.
    const simpleClass = ch === '[' && options.nobracket !== true
      ? /^\\[[a-zA-Z0-9*?._ -]+\\]/.exec(body.slice(i))
      : null;
    if (simpleClass) {
      i += simpleClass[0].length - 1;
      continue;
    }
    // Be conservative even for quoted stars and nested extglob openers.
    if (ch === '*') return { risky: true };
  }
`;

function hardenParser(source, version) {
  if (!hashes[version]) {
    throw new Error(`Unreviewed picomatch version ${version}; re-evaluate the security patch`);
  }
  const original = source.includes(anchor + guard)
    ? source.replace(anchor + guard, anchor)
    : source;
  const hash = createHash('sha256').update(original).digest('hex');
  if (hash !== hashes[version] || original.split(anchor).length !== 2) {
    throw new Error(`Unexpected picomatch ${version} parser; refusing to skip its security patch`);
  }
  return original.replace(anchor, anchor + guard);
}

function patchInstalled(root = path.resolve(__dirname, '..')) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const copies = Object.keys(lock.packages).filter(entry => entry.endsWith('node_modules/picomatch'));
  if (!copies.length) throw new Error('No picomatch copies found in the lockfile');
  let installed = 0;
  for (const entry of copies) {
    const directory = path.join(root, entry);
    if (!fs.existsSync(directory)) continue; // npm ci --omit=dev may omit copies
    const { version } = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const parser = path.join(directory, 'lib/parse.js');
    const source = fs.readFileSync(parser, 'utf8');
    const patched = hardenParser(source, version);
    if (source !== patched) fs.writeFileSync(parser, patched);
    installed++;
  }
  if (!installed) throw new Error('No installed picomatch copies could be secured');
  console.log(`Applied picomatch ReDoS mitigation to ${installed} installed copies`);
}

module.exports = { hardenParser, patchInstalled, guard };
if (require.main === module) patchInstalled();
