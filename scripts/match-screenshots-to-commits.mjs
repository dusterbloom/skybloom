import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const screenshotsDir = 'screenshots';

// Get all screenshot files with dates
const files = fs.readdirSync(screenshotsDir)
  .filter(f => f.endsWith('.png') && f !== 'image.png')
  .map(f => {
    const match = f.match(/Screenshot (\d{4}-\d{2}-\d{2})/);
    const date = match ? match[1] : null;
    const stat = fs.statSync(path.join(screenshotsDir, f));
    return {
      file: f,
      path: `screenshots/${f}`,
      date,
      mtime: stat.mtime.toISOString().slice(0, 10),
      size: stat.size
    };
  });

// Sort by date
files.sort((a, b) => (a.date || a.mtime).localeCompare(b.date || b.mtime));

// Get commits
const gitLog = execSync(
  'git log --all --format="%H|%ad|%s" --date=short',
  { encoding: 'utf-8' }
).trim().split('\n');

const commits = gitLog.map(line => {
  const [hash, date, ...rest] = line.split('|');
  return { hash: hash.slice(0, 8), date, message: rest.join('|') };
});

// Group commits by date
const commitsByDate = {};
for (const c of commits) {
  if (!commitsByDate[c.date]) commitsByDate[c.date] = [];
  commitsByDate[c.date].push(c);
}

// Match screenshots to commits
const matched = files.map(f => {
  const date = f.date || f.mtime;
  const sameDay = commitsByDate[date] || [];
  // Also find nearest commits within 3 days
  const nearby = [];
  for (let i = -3; i <= 3; i++) {
    const d = addDays(date, i);
    if (commitsByDate[d]) {
      nearby.push(...commitsByDate[d].map(c => ({ ...c, offset: i })));
    }
  }
  return {
    ...f,
    matchedDate: date,
    sameDayCommits: sameDay,
    nearbyCommits: nearby
  };
});

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Output as JSON for webpage generation
fs.writeFileSync('scripts/screenshot-commit-mapping.json', JSON.stringify(matched, null, 2));

// Output markdown summary
let md = '# Screenshot ↔ Commit Mapping\n\n';
for (const item of matched) {
  md += `## ${item.file}\n`;
  md += `- **Screenshot date:** ${item.date || 'unknown (using mtime: ' + item.mtime + ')' }\n`;
  md += `- **File:** ${item.path}\n`;
  if (item.sameDayCommits.length) {
    md += `- **Same-day commits:**\n`;
    for (const c of item.sameDayCommits) {
      md += `  - \`${c.hash}\` ${c.date} — ${c.message}\n`;
    }
  } else {
    md += `- **No commits on exact date. Nearby commits:**\n`;
    for (const c of item.nearbyCommits.slice(0, 5)) {
      md += `  - \`${c.hash}\` ${c.date} (${c.offset >= 0 ? '+' : ''}${c.offset}d) — ${c.message}\n`;
    }
  }
  md += '\n';
}

fs.writeFileSync('scripts/screenshot-commit-mapping.md', md);

console.log(`Matched ${matched.length} screenshots to commits.`);
console.log('Outputs: scripts/screenshot-commit-mapping.json, scripts/screenshot-commit-mapping.md');
