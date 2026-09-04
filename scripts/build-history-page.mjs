import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const templatePath = path.join(root, 'scripts', 'history-template.html');
const mappingPath = path.join(root, 'scripts', 'screenshot-commit-mapping.json');
const outputPath = path.join(root, 'public', 'history.html');

const template = fs.readFileSync(templatePath, 'utf-8');
const mapping = fs.existsSync(mappingPath)
  ? JSON.parse(fs.readFileSync(mappingPath, 'utf-8'))
  : [];

const escapeHtml = s => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const cards = mapping.map(item => {
  const commit = item.sameDayCommits[0] || item.nearbyCommits[0];
  const commitText = commit
    ? `<span class="proof__commit">${commit.hash} — ${escapeHtml(commit.message)}</span>`
    : `<span class="proof__commit">No nearby commit found</span>`;

  const dateLabel = escapeHtml(item.date || item.mtime);
  const imgPath = escapeHtml(item.path);

  return `
    <article class="proof__card">
      <img src="${imgPath}" alt="Screenshot from ${dateLabel}" loading="lazy" data-src="${imgPath}">
      <div class="proof__meta">
        <div class="proof__date">${dateLabel}</div>
        ${commitText}
      </div>
    </article>
  `;
}).join('\n');

const html = template
  .replace('{{GALLERY}}', cards)
  .replace('{{GALLERY_COUNT}}', String(mapping.length));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html);

console.log(`built public/history.html with ${mapping.length} screenshot cards`);
