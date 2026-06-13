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
      --vc-safe-x: max(14px, env(safe-area-inset-left));
      --vc-safe-y: max(14px, env(safe-area-inset-top));
      --vc-safe-right: max(14px, env(safe-area-inset-right));
      --vc-dev-hud-offset: 0px;
      --vc-minimap-size: 150px;
      --vc-left-stack-top: calc(var(--vc-safe-y) + var(--vc-dev-hud-offset));
      --vc-left-stack-after-minimap: calc(var(--vc-left-stack-top) + var(--vc-minimap-size) + 16px);
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
    .vc-tabbar {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      padding: 4px;
      margin-bottom: 12px;
      border: 1px solid var(--vc-border);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
    }
    .vc-tab {
      min-width: 0;
      min-height: 30px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--vc-ink-dim);
      font-family: var(--vc-font);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
    }
    .vc-tab[aria-selected="true"] {
      border-color: rgba(255, 204, 102, 0.35);
      background: rgba(255, 204, 102, 0.16);
      color: var(--vc-ink);
    }
    .vc-toast-stack {
      position: fixed;
      top: calc(var(--vc-safe-y) + 10px);
      left: 50%;
      transform: translateX(-50%);
      width: min(420px, calc(100vw - 32px));
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      pointer-events: none;
      z-index: 1100;
    }
    .vc-toast {
      box-sizing: border-box;
      width: 100%;
      background: rgba(20, 30, 60, 0.82);
      color: #fff;
      padding: 8px 14px;
      border-radius: 10px;
      border-left: 3px solid var(--vc-cyan);
      font-family: var(--vc-font);
      font-size: 14px;
      line-height: 1.35;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    }
    @media (max-width: 640px) {
      :root {
        --vc-minimap-size: 108px;
      }
      .vc-toast-stack {
        top: auto;
        bottom: max(92px, calc(env(safe-area-inset-bottom) + 18px));
        width: min(340px, calc(100vw - 28px));
      }
    }
  `;
  document.head.appendChild(style);
}
