import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcDir = path.join(root, 'screenshots');
const distDir = path.join(root, 'dist', 'screenshots');

if (!fs.existsSync(srcDir)) {
  console.log('no screenshots/ directory found; skipping');
  process.exit(0);
}

fs.mkdirSync(distDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.png'));
let copied = 0;

for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
  copied++;
}

console.log(`copied ${copied} screenshots to dist/screenshots`);
