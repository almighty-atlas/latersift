import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte({ compilerOptions: { fragments: 'tree' } })],
  base: './',
  build: { target: 'firefox128' },
});
