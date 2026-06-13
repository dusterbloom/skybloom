import { defineConfig } from 'vite';

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
  const sha = process.env.VITE_GIT_SHA || process.env.GITHUB_SHA;
  return sha ? sha.slice(0, 12) : 'local';
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
