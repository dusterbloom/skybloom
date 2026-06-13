import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = new Set(process.argv.slice(2));
const root = process.cwd();
const distDir = resolve(root, 'dist');
const port = Number(process.env.PORT || process.env.SKYBLOOM_PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

if (args.has('--build')) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['run', 'build'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('SkyBloom is not built yet.');
  console.error('Run `npm install && npm run play`, or download a release zip that includes dist/.');
  process.exit(1);
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const withoutBase = clean.startsWith('/skybloom/') ? clean.slice('/skybloom'.length) : clean;
  const filePath = resolve(distDir, `.${withoutBase}`);
  return filePath.startsWith(distDir + sep) || filePath === distDir ? filePath : join(distDir, 'index.html');
}

const server = createServer((req, res) => {
  let filePath = safePath(req.url || '/');
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(distDir, 'index.html');

  res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
  res.setHeader('Content-Type', contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream');
  createReadStream(filePath)
    .on('error', () => {
      res.writeHead(500);
      res.end('SkyBloom could not read this file.');
    })
    .pipe(res);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`SkyBloom could not start because ${host}:${port} is already in use.`);
    console.error('Set a different port with `PORT=4174 node scripts/play.mjs`.');
  } else if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error(`SkyBloom could not listen on ${host}:${port}.`);
    console.error('Try a different port, or check local firewall and permission settings.');
  } else {
    console.error('SkyBloom could not start:', error.message || error);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`SkyBloom is running at ${url}`);
  console.log('Press Ctrl+C to stop.');
});
