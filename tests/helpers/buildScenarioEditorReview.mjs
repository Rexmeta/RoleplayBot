/**
 * Bundle the real editor with read-only, isolated fixtures for visual checks.
 * Usage: node tests/helpers/buildScenarioEditorReview.mjs /tmp/editor-review
 * Run Tailwind separately for base.css. Never serve this from the main app.
 */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = process.argv[2];
if (!output) throw new Error('An explicit temporary output directory is required');
const editor = ['persona', 'content'].includes(process.argv[3]) ? process.argv[3] : 'scenario';
const root = process.cwd();
const fixture = path.join(root, `tests/fixtures/${editor}EditorReviewData.ts`);
const stubs = {
  '@tanstack/react-query': ['useQuery', 'useMutation', 'useQueryClient'],
  '@/hooks/useAuth': ['useAuth'],
  '@/hooks/use-toast': ['useToast', 'toast'],
  '@/lib/localeUtils': ['useDefaultSourceLocale'],
  '@/lib/queryClient': ['apiRequest', 'streamApiRequest', 'queryClient'],
};
await mkdir(output, { recursive: true });
await build({
  entryPoints: [`tests/fixtures/${editor}EditorReview.tsx`], bundle: true,
  outfile: path.join(output, 'review.js'), format: 'esm', platform: 'browser',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  tsconfig: 'tsconfig.json', loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  plugins: [{
    name: 'read-only-review-fixtures',
    setup(plugin) {
      plugin.onResolve({ filter: /^(?:@tanstack\/react-query|@\/hooks\/(?:useAuth|use-toast)|@\/lib\/(?:localeUtils|queryClient))$/ }, args =>
        ({ path: args.path, namespace: 'review-stub' }));
      plugin.onLoad({ filter: /.*/, namespace: 'review-stub' }, args => ({
        contents: `export { ${stubs[args.path].join(', ')} } from ${JSON.stringify(fixture)};`,
        resolveDir: root, loader: 'ts',
      }));
      plugin.onResolve({ filter: /^\.\/AIScenarioGenerator$/ }, () => ({ path: 'ai-generator', namespace: 'review-empty' }));
      plugin.onLoad({ filter: /.*/, namespace: 'review-empty' }, () => ({
        contents: 'export const AIScenarioGenerator = () => null;', loader: 'js',
      }));
    },
  }],
});
await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Read-only editor visual fixture</title><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="review.css"></head><body><div id="root"></div><script type="module" src="review.js"></script></body></html>');
console.log(`Read-only visual fixture built in ${output}`);
