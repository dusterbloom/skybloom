import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function getBuildVersion() {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (error) {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    __SKYBLOOM_BUILD_VERSION__: JSON.stringify(getBuildVersion()),
  },
  server: {
    host: true,
    allowedHosts: "5bd8b27a9ba59fc395c819e14185d356.serveo.net"
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    optimizeDeps: {
      include: ['three', 'simplex-noise']
    },
    minify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          game: ['./src/game/core/Engine.js']
        }
      }
    }
  }
});
