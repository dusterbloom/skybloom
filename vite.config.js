import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function getBasePath() {
  if (process.env.VITE_BASE_PATH) return normalizeBasePath(process.env.VITE_BASE_PATH);
  if (process.env.GITHUB_PAGES === 'true') {
    const repo = (process.env.GITHUB_REPOSITORY || 'dusterbloom/skybloom').split('/')[1] || 'skybloom';
    return `/${repo}/`;
  }
  return '/';
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === '.') return './';
  let value = basePath.startsWith('/') ? basePath : `/${basePath}`;
  if (!value.endsWith('/')) value += '/';
  return value;
}

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
  base: getBasePath(),
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
