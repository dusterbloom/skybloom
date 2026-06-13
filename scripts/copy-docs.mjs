import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDocs = path.join(root, 'dist', 'docs');
const docs = [
  'AGENT_API.md',
  'AGENT_QUICKSTART.md',
  'BENCHMARK.md',
  'STATUS_AND_ROADMAP.md',
  'VERIFIED_LEADERBOARD_ROADMAP.md',
];

fs.mkdirSync(distDocs, { recursive: true });

for (const doc of docs) {
  fs.copyFileSync(path.join(root, 'docs', doc), path.join(distDocs, doc));
}

console.log(`copied ${docs.length} docs to dist/docs`);
