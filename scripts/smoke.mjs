import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'index.html',
  'src/game/systems/RaceSystem.js',
  'src/game/systems/AgentAPISystem.js',
  'src/agents/SimpleBot.js',
  'docs/AGENT_API.md',
  'docs/BENCHMARK.md',
  'docs/AGENT_QUICKSTART.md',
  'docs/VERIFIED_LEADERBOARD_ROADMAP.md',
  '.github/workflows/ci.yml',
  '.github/workflows/pages.yml',
  'scripts/play.mjs',
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`smoke: ${message}`);
    process.exitCode = 1;
  }
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const pkg = JSON.parse(read('package.json'));
assert(pkg.scripts?.build?.includes('vite build'), 'package.json must expose npm run build');
assert(typeof pkg.scripts?.play === 'string', 'package.json must expose npm run play');
assert(typeof pkg.scripts?.['build:pages'] === 'string', 'package.json must expose npm run build:pages');
assert(typeof pkg.scripts?.preview === 'string', 'package.json must expose npm run preview');
assert(typeof pkg.scripts?.smoke === 'string', 'package.json must expose npm run smoke');

const race = read('src/game/systems/RaceSystem.js');
assert(race.includes('exportResult'), 'RaceSystem must expose result export');
assert(race.includes('verificationStatus'), 'RaceSystem exports must include verification status');
assert(race.includes('runSimpleBot'), 'RaceSystem must expose SimpleBot controls');
assert(race.includes('Start Race'), 'Race panel controls must be present');

const api = read('src/game/systems/AgentAPISystem.js');
assert(api.includes('exportResult'), 'Agent API must delegate exportResult');
assert(api.includes('getLatestReplay'), 'Agent API must expose getLatestReplay');

const readme = read('README.md');
assert(readme.includes('Research Mode'), 'README must surface research mode');
assert(readme.includes('SimpleBot'), 'README must explain SimpleBot');

if (fs.existsSync(path.join(root, 'dist/index.html'))) {
  const dist = read('dist/index.html');
  const assetRefs = Array.from(dist.matchAll(/(?:src|href)="\/([^"]+)"/g)).map((m) => m[1]);
  for (const asset of assetRefs) {
    if (asset.startsWith('src/')) continue;
    const repoBase = `${pkg.name}/`;
    const normalized = asset.startsWith(repoBase) ? asset.slice(repoBase.length) : asset;
    assert(fs.existsSync(path.join(root, 'dist', normalized)), `dist asset missing: ${asset}`);
  }

  for (const file of requiredFiles.filter((file) => file.startsWith('docs/'))) {
    assert(fs.existsSync(path.join(root, 'dist', file)), `dist doc missing: ${file}`);
  }
}

if (!process.exitCode) {
  console.log('smoke: release surface looks coherent');
}
