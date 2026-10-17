import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
await build({
  entryPoints: ['src/background.ts', 'src/content.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'firefox140',
  minify: true,
  sourcemap: false,
});

await copyFile('LICENSE', 'dist/LICENSE');
