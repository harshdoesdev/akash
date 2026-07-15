import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // main.js uses top-level await for the asset preload gate.
  build: { target: 'es2022' },
});
