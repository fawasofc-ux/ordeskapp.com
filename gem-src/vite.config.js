import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Two targets from one source tree:
//   BUILD_TARGET=test → /gem/test/  (staging, reviewed before going live)
//   default           → /gem/       (production)
// Staging must be built and reviewed first; production is only rebuilt once
// the staging copy is approved.
const isTest = process.env.BUILD_TARGET === 'test';
const BASE = isTest ? '/gem/test/' : '/gem/';
const OUT = isTest ? '../gem/test' : '../gem';

// Unique id per build — baked into the bundle AND written to version.json,
// so the running app can detect when a newer deploy is live and reload.
const BUILD_ID = Date.now().toString(36);

// The staging build lives INSIDE the production output folder (gem/test), so
// Vite's own emptyOutDir would delete it on every production build. Clean the
// production files by hand instead and leave test/ alone.
const PRESERVE = new Set(['test']);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'clean-outdir-preserving-staging',
      buildStart() {
        const dir = resolve(__dirname, OUT);
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir)) {
          if (!isTest && PRESERVE.has(entry)) continue;
          rmSync(resolve(dir, entry), { recursive: true, force: true });
        }
      },
    },
    {
      name: 'emit-version-json',
      closeBundle() {
        writeFileSync(
          resolve(__dirname, OUT, 'version.json'),
          JSON.stringify({ build: BUILD_ID, builtAt: new Date().toISOString(), target: isTest ? 'test' : 'prod' }),
        );
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __IS_STAGING__: JSON.stringify(isTest),
  },
  base: BASE,
  build: {
    outDir: OUT,
    emptyOutDir: false, // handled by the plugin above so gem/test survives
  },
});
