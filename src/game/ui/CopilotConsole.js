// CopilotConsole — a persistent chat panel for the voice co-pilot.
//
// Single responsibility: render a turn stream (assistant/user/system lines),
// collect typed text, and hand it off. This module knows nothing about speech
// recognition, TTS, the LLM, or the game engine — its only outward dependency
// is the onSubmit(text) callback the host wires to VoiceCopilot#say(). That
// keeps voice and typing two inputs into the same conversation instead of two
// separate code paths.
//
// Keyboard safety: the text field below is a real <input>, so InputManager's
// existing global keydown/keyup handlers already recognize it via
// isEditableTarget and skip flight controls while it has focus (see every
// window-level game-key listener in the codebase — RaceSystem's KeyR
// handler, UISystem's KeyQ/1-3 handlers — they all gate on that same check).
// We deliberately add NO competing keydown/stopPropagation logic here: doing
// so risks re-introducing the stuck-key bug this repo has already hit once
// (a keyup swallowed while a field had focus leaves a flight key held down
// forever). The only key handling in this file is Enter-to-send on the input
// itself, which never touches propagation.
import { ensureVibeTheme } from './theme.js';

const STYLE_ID = 'copilot-console-style';
const MAX_LINES = 200;
const NEAR_BOTTOM_PX = 48;

// Real, working prompts pulled from VoiceCopilot's SYSTEM prompt — each one
// exercises a different thing the co-pilot can actually do (terrain, travel,
// world knobs, vehicles, music, and the genie's own "what can you do" line).
const EXAMPLE_PROMPTS = [
  'raise a mountain ahead',
  'take me to the crystal formation',
  'make it sunset',
  'let me fly the fox',
  'make the music epic',
  'what can you summon?',
];

let stylesInjected = false;

function ensureConsoleStyles() {
  if (stylesInjected || document.getElementById(STYLE_ID)) { stylesInjected = true; return; }
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #copilot-console {
      position: fixed;
      /* Bottom-LEFT on desktop: the settings menu (and its Agent tab, where
         Talk lives) docks top-right and can run tall, and top-right/top-left
         are the minimap's and the toggle's turf. Bottom-left is the one
         corner nothing else on desktop claims. */
      left: var(--vc-safe-x);
      bottom: var(--vc-safe-bottom);
      width: min(380px, calc(100vw - 32px));
      max-height: min(58vh, 560px);
      display: flex;
      flex-direction: column;
      z-index: 1050;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    }
    #copilot-console .cc-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 10px 10px 14px;
      border-bottom: 1px solid var(--vc-border);
      flex: 0 0 auto;
    }
    #copilot-console .cc-title {
      font-family: var(--vc-font);
      font-weight: 600;
      font-size: 13px;
      color: var(--vc-ink);
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #copilot-console .cc-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--vc-ink-dim);
      flex: 0 0 auto;
      transition: background .2s ease;
    }
    #copilot-console .cc-dot.cc-dot-pulse { animation: cc-pulse 1.1s ease-in-out infinite; }
    @keyframes cc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    #copilot-console .cc-status {
      font-family: var(--vc-font);
      font-size: 11px;
      color: var(--vc-ink-dim);
      flex: 0 0 auto;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #copilot-console .cc-close {
      flex: 0 0 auto;
      width: 26px; height: 26px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%;
      border: 1px solid var(--vc-border);
      background: transparent;
      color: var(--vc-ink-dim);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
    }
    #copilot-console .cc-close:hover { color: var(--vc-ink); border-color: var(--vc-gold); }
    #copilot-console .cc-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #copilot-console .cc-line {
      font-family: var(--vc-font);
      font-size: 13px;
      line-height: 1.4;
      max-width: 92%;
      padding: 7px 11px;
      border-radius: 12px;
      word-break: break-word;
      white-space: pre-wrap;
    }
    #copilot-console .cc-line-user {
      align-self: flex-end;
      background: rgba(255, 255, 255, 0.10);
      color: var(--vc-ink);
      border-bottom-right-radius: 4px;
    }
    #copilot-console .cc-line-assistant {
      align-self: flex-start;
      background: rgba(102, 255, 238, 0.10);
      border: 1px solid rgba(102, 255, 238, 0.20);
      color: var(--vc-ink);
      border-bottom-left-radius: 4px;
    }
    #copilot-console .cc-line-system {
      align-self: center;
      background: transparent;
      color: var(--vc-ink-dim);
      font-size: 11px;
      padding: 2px 8px;
      max-width: 100%;
      text-align: center;
    }
    #copilot-console .cc-empty {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #copilot-console .cc-empty-hint {
      font-family: var(--vc-font);
      font-size: 12px;
      color: var(--vc-ink-dim);
    }
    #copilot-console .cc-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    #copilot-console .cc-chips .vc-chip {
      cursor: pointer;
      border: 1px solid var(--vc-border);
      background: rgba(255, 255, 255, 0.05);
    }
    #copilot-console .cc-chips .vc-chip:hover { border-color: var(--vc-gold); }
    #copilot-console .cc-hint {
      font-family: var(--vc-font);
      font-size: 11px;
      color: var(--vc-ink-dim);
      padding: 0 12px 6px;
      flex: 0 0 auto;
    }
    #copilot-console .cc-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px 12px;
      border-top: 1px solid var(--vc-border);
      flex: 0 0 auto;
    }
    #copilot-console .cc-input {
      flex: 1 1 auto;
      min-width: 0;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--vc-border);
      border-radius: 999px;
      color: var(--vc-ink);
      font-family: var(--vc-font);
      font-size: 13px;
      padding: 9px 14px;
      outline: none;
    }
    #copilot-console .cc-input:focus { border-color: var(--vc-gold); }
    #copilot-console .cc-send {
      flex: 0 0 auto;
      padding: 9px 16px;
      font-size: 13px;
    }
    #copilot-console .cc-send:disabled { opacity: 0.5; cursor: default; }
    @media (max-width: 640px) {
      #copilot-console {
        right: var(--vc-safe-right);
        left: var(--vc-safe-x);
        bottom: auto;
        top: calc(var(--vc-safe-y) + 92px);
        width: auto;
        max-height: 46vh;
      }
    }
  `;
  document.head.appendChild(style);
}

// State -> {dot color var, label, pulse}. Mirrors VoiceCopilot's onState values.
const STATE_INFO = {
  idle: { label: 'starting…', color: 'var(--vc-ink-dim)', pulse: false },
  ready: { label: 'ready', color: 'var(--vc-cyan)', pulse: false },
  listening: { label: 'listening…', color: 'var(--vc-gold)', pulse: true },
  thinking: { label: 'thinking…', color: 'var(--vc-gold)', pulse: true },
  speaking: { label: 'speaking…', color: 'var(--vc-magenta)', pulse: false },
  'no-mic': { label: 'typing only', color: 'var(--vc-ink-dim)', pulse: false },
  off: { label: 'offline', color: 'var(--vc-ink-dim)', pulse: false },
};

export function createCopilotConsole({ onSubmit, onClose } = {}) {
  ensureVibeTheme();
  ensureConsoleStyles();

  const root = document.createElement('div');
  root.id = 'copilot-console';
  root.className = 'vc-panel';
  root.style.display = 'none'; // hidden until show()

  // --- header: title, status dot + label, close ---
  const head = document.createElement('div');
  head.className = 'cc-head';
  const title = document.createElement('div');
  title.className = 'cc-title';
  title.textContent = '🪄 Co-Pilot';
  const dot = document.createElement('div');
  dot.className = 'cc-dot';
  const status = document.createElement('div');
  status.className = 'cc-status';
  status.textContent = STATE_INFO.idle.label;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cc-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  head.appendChild(title);
  head.appendChild(dot);
  head.appendChild(status);
  head.appendChild(closeBtn);
  root.appendChild(head);

  // --- scrollback (turn stream) ---
  const scroll = document.createElement('div');
  scroll.className = 'cc-scroll';
  root.appendChild(scroll);

  // --- empty-state discovery chips (shown until the first turn arrives) ---
  const empty = document.createElement('div');
  empty.className = 'cc-empty';
  const emptyHint = document.createElement('div');
  emptyHint.className = 'cc-empty-hint';
  emptyHint.textContent = 'Talk or type — try one of these, or ask for anything:';
  const chips = document.createElement('div');
  chips.className = 'cc-chips';
  const chipCleanups = [];
  for (const prompt of EXAMPLE_PROMPTS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'vc-chip';
    chip.textContent = prompt;
    const onChipClick = () => submit(prompt);
    chip.addEventListener('click', onChipClick);
    chipCleanups.push(() => chip.removeEventListener('click', onChipClick));
    chips.appendChild(chip);
  }
  empty.appendChild(emptyHint);
  empty.appendChild(chips);
  root.appendChild(empty);
  scroll.style.display = 'none'; // empty state owns the space until the first turn

  // --- pending hint (visible only while thinking) ---
  const pendingHint = document.createElement('div');
  pendingHint.className = 'cc-hint';
  pendingHint.textContent = '🪄 the co-pilot is thinking…';
  pendingHint.hidden = true;
  root.appendChild(pendingHint);

  // --- input row ---
  const inputRow = document.createElement('div');
  inputRow.className = 'cc-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cc-input';
  input.placeholder = 'Type to the co-pilot…';
  input.autocomplete = 'off';
  input.maxLength = 500;
  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'vc-btn-primary cc-send';
  sendBtn.textContent = 'Send';
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  root.appendChild(inputRow);

  document.body.appendChild(root);

  let turnCount = 0;
  let thinking = false;

  function submit(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || thinking) return;
    input.value = '';
    if (turnCount === 0) { scroll.style.display = ''; empty.remove(); }
    try { onSubmit && onSubmit(trimmed); } catch (error) { /* host's problem, not the console's */ }
  }

  const onSendClick = () => submit(input.value);
  // Enter sends; Shift+Enter is irrelevant on a single-line field (browsers
  // ignore it), so nothing extra to special-case there.
  const onInputKeydown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit(input.value); }
  };
  const onCloseClick = () => { hide(); try { onClose && onClose(); } catch (error) { /* best effort */ } };

  sendBtn.addEventListener('click', onSendClick);
  input.addEventListener('keydown', onInputKeydown);
  closeBtn.addEventListener('click', onCloseClick);

  function push({ role, text } = {}) {
    if (!text) return;
    if (turnCount === 0) { scroll.style.display = ''; empty.remove(); }
    turnCount++;

    const wasNearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < NEAR_BOTTOM_PX;

    const line = document.createElement('div');
    line.className = `cc-line cc-line-${role === 'user' || role === 'assistant' ? role : 'system'}`;
    // textContent only — turn text comes from the model and the player, never markup.
    line.textContent = role === 'assistant' ? `🪄 ${text}` : text;
    scroll.appendChild(line);

    while (scroll.children.length > MAX_LINES) scroll.removeChild(scroll.firstChild);

    // Auto-scroll only when the reader was already at (or near) the bottom —
    // otherwise a new line while reading history would yank the view down.
    if (wasNearBottom) scroll.scrollTop = scroll.scrollHeight;
  }

  function setState(state) {
    const info = STATE_INFO[state] || STATE_INFO.idle;
    dot.style.background = info.color;
    dot.classList.toggle('cc-dot-pulse', !!info.pulse);
    status.textContent = info.label;
    thinking = state === 'thinking';
    sendBtn.disabled = thinking;
    pendingHint.hidden = !thinking;
  }

  function show() { root.style.display = 'flex'; }
  function hide() { root.style.display = 'none'; }

  function destroy() {
    sendBtn.removeEventListener('click', onSendClick);
    input.removeEventListener('keydown', onInputKeydown);
    closeBtn.removeEventListener('click', onCloseClick);
    for (const cleanup of chipCleanups) cleanup();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { push, setState, show, hide, destroy };
}
