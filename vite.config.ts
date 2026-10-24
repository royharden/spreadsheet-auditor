import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The workbook is parsed in a module worker (src/worker/parse.worker.ts, M2); nothing is uploaded.
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
