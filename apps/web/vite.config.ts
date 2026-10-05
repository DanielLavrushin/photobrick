import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The production build goes straight into the Go server's embed directory, so `make build`
// produces one static binary with the UI inside (see server/internal/webui).
const outDir = fileURLToPath(new URL('../../server/internal/webui/dist', import.meta.url));

// emptyOutDir wipes the tracked placeholder that lets the Go server compile without a UI build.
function keepGitkeep(): Plugin {
  return {
    name: 'photobrick-keep-gitkeep',
    apply: 'build',
    closeBundle() {
      writeFileSync(join(outDir, '.gitkeep'), '');
    },
  };
}

export default defineConfig({
  plugins: [react(), keepGitkeep()],
  worker: { format: 'es' },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
  },
});
