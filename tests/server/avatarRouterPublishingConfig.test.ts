import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = '.local/avatarrouter-connection';
const api = readFileSync(`${workspace}/artifacts/api-server/.replit-artifact/artifact.toml`, 'utf8');
const web = readFileSync(`${workspace}/artifacts/avatar-router/.replit-artifact/artifact.toml`, 'utf8');

function commandArray(line: string): string[] {
  return JSON.parse(line.slice(line.indexOf('=') + 1).trim());
}

describe('nested AvatarRouter publishing configuration', () => {
  it('scopes both API service builds to the canonical workspace, not diagnostic copies', () => {
    const builds = [...api.matchAll(/\[services\.production\.build\]\s*\n(args = \[[^\n]+\])/g)];
    expect(builds).toHaveLength(2);
    for (const match of builds) {
      expect(commandArray(match[1])).toEqual([
        'pnpm', '--dir', workspace, '--filter', '@workspace/api-server', '--fail-if-no-match', 'run', 'build',
      ]);
    }
  });

  it('scopes the web build to the same workspace and fails on a missing package', () => {
    const line = web.split('\n').find(line => line.startsWith('build = '))!;
    expect(commandArray(line)).toEqual([
      'pnpm', '--dir', workspace, '--filter', '@workspace/avatar-router', '--fail-if-no-match', 'run', 'build',
    ]);
  });

  it('uses the matching production entrypoints and static output paths', () => {
    expect(api).toContain(`"${workspace}/artifacts/api-server/dist/index.mjs"`);
    expect(api).toContain(`"${workspace}/artifacts/api-server/dist/renderer.mjs"`);
    expect(web).toContain(`publicDir = "${workspace}/artifacts/avatar-router/dist/public"`);
    expect(api).not.toContain('generated-artifacts/');
    expect(web).not.toContain('generated-artifacts/');
  });
});
