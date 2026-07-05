import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Unique id per build — baked into the bundle AND written to version.json,
// so the running app can detect when a newer deploy is live and reload.
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      closeBundle() {
        writeFileSync(
          resolve(__dirname, '../gem/version.json'),
          JSON.stringify({ build: BUILD_ID, builtAt: new Date().toISOString() }),
        );
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  base: '/gem/',
  build: {
    outDir: '../gem',
    emptyOutDir: true,
  },
});
