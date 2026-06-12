// SkyBloom UI theme — "Twilight Glass".
// One source of truth for menu/HUD styling: deep-indigo glass panels carrying
// the world's own accent palette (beacon gold, mana cyan, trail magenta).
// Inject once via ensureVibeTheme(); style with the .vc-* classes or the
// CSS variables — never hardcode panel colors in components.

let injected = false;

export const VC = {
  font: "'Sora', 'Outfit', 'Segoe UI', system-ui, sans-serif",
  panel: 'rgba(13, 18, 38, 0.55)',
  panelSolid: 'rgba(13, 18, 38, 0.92)',
  border: 'rgba(255, 255, 255, 0.10)',
  ink: '#f2f5ff',
  inkDim: 'rgba(242, 245, 255, 0.62)',
  gold: '#ffcc66',
  cyan: '#66ffee',
  magenta: '#ff66cc',
  radius: '12px',
};

export function ensureVibeTheme() {
  if (injected || document.getElementById('vc-theme')) { injected = true; return; }
  injected = true;

  // Display font; silently falls back to system fonts offline.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;600;800&display=swap';
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.id = 'vc-theme';
  style.textContent = `
    :root {
      --vc-font: ${VC.font};
      --vc-panel: ${VC.panel};
      --vc-panel-solid: ${VC.panelSolid};
      --vc-border: ${VC.border};
      --vc-ink: ${VC.ink};
      --vc-ink-dim: ${VC.inkDim};
      --vc-gold: ${VC.gold};
      --vc-cyan: ${VC.cyan};
      --vc-magenta: ${VC.magenta};
      --vc-radius: ${VC.radius};
    }
    .vc-panel {
      background: var(--vc-panel);
      border: 1px solid var(--vc-border);
      border-radius: var(--vc-radius);
      color: var(--vc-ink);
      font-family: var(--vc-font);
    }
    @supports (backdrop-filter: blur(10px)) {
      .vc-panel { backdrop-filter: blur(10px); }
    }
    .vc-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px;
      background: var(--vc-panel); border: 1px solid var(--vc-border);
      color: var(--vc-ink); font-family: var(--vc-font); font-size: 13px;
    }
    .vc-label {
      font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--vc-ink-dim); font-family: var(--vc-font);
    }
    .vc-num { font-variant-numeric: tabular-nums; }
    .vc-btn-primary {
      font-family: var(--vc-font); font-weight: 600; color: #1a1303;
      background: linear-gradient(180deg, #ffd98a, var(--vc-gold));
      border: none; border-radius: 999px; cursor: pointer;
      padding: 16px 44px; font-size: 19px; letter-spacing: 0.04em;
      box-shadow: 0 0 24px rgba(255, 204, 102, 0.35);
      transition: transform .2s ease, box-shadow .2s ease;
    }
    .vc-btn-primary:hover { transform: scale(1.04); box-shadow: 0 0 36px rgba(255, 204, 102, 0.55); }
    .vc-btn-ghost {
      font-family: var(--vc-font); color: var(--vc-ink);
      background: transparent; border: 1px solid var(--vc-border);
      border-radius: 999px; cursor: pointer; padding: 9px 18px; font-size: 14px;
      transition: border-color .2s ease, background .2s ease;
    }
    .vc-btn-ghost:hover { border-color: var(--vc-gold); background: rgba(255, 204, 102, 0.08); }
  `;
  document.head.appendChild(style);
}
