import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/gem/',
  build: {
    outDir: '../gem',
    emptyOutDir: true,
  },
});
