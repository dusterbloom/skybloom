/**
 * Pluggable voice-output providers for the voice co-pilot — the TTS mirror of
 * llmProviders.js. One interface:
 *   const v = await createVoice(config);
 *   await v.speak('hello', { signal });   // resolves when the utterance ends
 *   await v.dispose();
 *
 * Three backends:
 *   - browser    : the OS's own speechSynthesis voices (Siri-family on macOS/iOS,
 *                  "Natural" voices on Windows, Google voices on Android/Chrome).
 *                  Zero bytes, zero latency — already on the device. DEFAULT.
 *   - kokoro     : Kokoro-82M, on-device neural TTS via kokoro-js (CDN, WebGPU/wasm).
 *   - supertonic : Supertonic-3, on-device neural TTS via onnxruntime-web (CDN/HF).
 * Kokoro and Supertonic sound noticeably better than the OS voice, but cost an
 * onnxruntime-web/kokoro-js download plus model weights from a CDN/HuggingFace
 * before the first word — an explicit "download a better voice" opt-in via
 * config.tts, not the thing every player pays for by default.
 *
 * VoiceCopilot owns the AudioContext (it must be created synchronously inside
 * the user's click on Talk, or browsers keep it suspended — see the comment on
 * VoiceCopilot.start()). This module never constructs one; PCM-playing voices
 * pull it from config.getAudioContext() at speak time.
 *
 * Fallback is ONE decorator here, not scattered try/catch: if the requested
 * neural voice fails to load, or throws while speaking, createVoice reports it
 * once through config.onStatus(text) and permanently routes every subsequent
 * speak() through the browser voice for the life of this instance. A neural
 * voice that hiccups once still isn't worth re-trying and re-failing every turn.
 */
import { createSupertonicTTS } from './supertonicTTS.js';

const VOICE_IDS = ['browser', 'kokoro', 'supertonic'];

/** Coerce a saved/typed tts id to a known one. Unset or unrecognized -> 'browser'
 *  (the OS voice) — free and instant, the right default for the first turn. */
export function normalizeTtsId(id) {
  return VOICE_IDS.includes(id) ? id : 'browser';
}

function abortedError() {
  const err = new Error('speak aborted');
  err.name = 'AbortError';
  return err;
}

export async function createVoice(config = {}) {
  const onStatus = config.onStatus || (() => {});
  const id = normalizeTtsId(config.tts);
  const browserVoice = createBrowserVoice(config);
  if (id === 'browser') return browserVoice;

  const label = id === 'kokoro' ? 'Kokoro' : 'Supertonic';
  let primary = null;
  try {
    primary = id === 'kokoro' ? await createKokoroVoice(config) : await createSupertonicVoice(config);
  } catch (e) {
    // A neural voice that won't even load must not block the co-pilot.
    onStatus(`(${id} voice unavailable — using the browser voice)`);
  }
  return withFallback(label, primary, browserVoice, onStatus);
}

// The one fallback wrapper: try the chosen voice; on ANY failure (init already
// failed above, or a throw mid-speak) warn once and fall through to the browser
// voice permanently — not just for this turn, so a flaky neural backend doesn't
// re-fail (and re-warn) every single turn for the rest of the session.
function withFallback(label, primary, browserVoice, onStatus) {
  let fellBack = !primary;
  const warnOnce = (err) => {
    if (fellBack) return;
    fellBack = true;
    onStatus(`(${label} voice failed — using the browser voice. ${err && err.message ? err.message : ''})`.trim());
  };
  return {
    async speak(text, opts) {
      if (fellBack) return browserVoice.speak(text, opts);
      try {
        return await primary.speak(text, opts);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e; // a cancelled turn is not a voice failure
        warnOnce(e);
        try { await primary.dispose(); } catch (e2) { /* best effort */ }
        return browserVoice.speak(text, opts);
      }
    },
    async dispose() {
      try { if (primary) await primary.dispose(); } catch (e) { /* best effort */ }
      try { await browserVoice.dispose(); } catch (e) { /* best effort */ }
    },
  };
}

// ===== browser (OS) voice ===================================================

// speechSynthesis.getVoices() is async-populated in Chrome: the first call
// returns [] and the real list arrives later via the 'voiceschanged' event.
// Wait for it, bounded — an empty list must not mean "no voices" forever, but
// it also must not hang speak() if the event never fires (some embedders never
// send it at all).
function getVoicesAsync(synth, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const have = synth.getVoices();
    if (have && have.length) { resolve(have); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { synth.removeEventListener('voiceschanged', onChange); } catch (e) { /* ignore */ }
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const onChange = () => finish();
    try { synth.addEventListener('voiceschanged', onChange); } catch (e) { /* older engines: no event at all */ }
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Pure ranking function — exported so it's testable and lives in exactly one
 * place. Language is a CORRECTNESS constraint, not a tie-breaker: a voice that
 * can't pronounce the requested language isn't a candidate at all, so the list
 * is first filtered to voices whose primary subtag matches (e.g. 'en' matches
 * both 'en-US' and 'en-GB') — falling back to the full, unfiltered list only
 * when nothing matches (better an accented voice than dead silence). WITHIN
 * that language-matching set, rank by: on-device voices first (localService,
 * no network round trip), then known-good platform families (macOS/iOS
 * premium & Siri-family, Windows "Natural" voices, Google voices on
 * Android/Chrome), then the platform default. Returns null for an empty list
 * — speak() still works with no voice selected (a bare SpeechSynthesisUtterance
 * falls back to the platform default voice).
 */
export function pickSystemVoice(voices, lang = 'en-US') {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const prefix = String(lang || '').split(/[-_]/)[0].toLowerCase();
  const matching = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
  const pool = matching.length ? matching : voices;
  // Weights are spaced so a higher tier always outranks any stack of lower
  // ones (100 > 10 > 1) — a simple additive score reproduces the strict tier
  // order without needing a multi-key sort. No language term here: `pool` is
  // already restricted to matches (or, failing that, everything) above.
  const FAMILY_RE = /premium|enhanced|siri|natural|^google/i;
  const score = (v) => {
    let s = 0;
    if (v.localService === true) s += 100;
    if (FAMILY_RE.test(v.name || '')) s += 10;
    if (v.default) s += 1;
    return s;
  };
  let best = pool[0];
  let bestScore = score(best);
  for (let i = 1; i < pool.length; i++) {
    const s = score(pool[i]);
    if (s > bestScore) { bestScore = s; best = pool[i]; }
  }
  return best;
}

function createBrowserVoice(config) {
  const lang = config.lang || 'en-US';
  return {
    async speak(text, { signal } = {}) {
      if (!text) return;
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      if (signal && signal.aborted) throw abortedError();
      const synth = window.speechSynthesis;
      const voice = pickSystemVoice(await getVoicesAsync(synth), lang);
      return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          if (signal) signal.removeEventListener('abort', onAbort);
          clearTimeout(timer);
        };
        const finish = () => { if (settled) return; settled = true; cleanup(); resolve(); };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          try { synth.cancel(); } catch (e) { /* ignore */ }
          reject(abortedError());
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang;
        u.rate = 1.0;
        if (voice) u.voice = voice;
        u.onend = finish;
        u.onerror = finish;
        // A headless/no-installed-voice environment (headless Chromium, some
        // Linux desktops) can fire NEITHER onend nor onerror — speak() would
        // hang forever and wedge the turn at 'speaking'. Bound it, proportional
        // to how long the utterance should take (~90ms/char at rate 1.0), with
        // a sane floor and ceiling.
        const timer = setTimeout(finish, Math.min(20000, Math.max(4000, text.length * 90)));
        try { synth.speak(u); } catch (e) { finish(); }
      });
    },
    async dispose() {
      try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
  };
}

// ===== shared PCM playback (Kokoro + Supertonic) ============================

// Float32 PCM -> WebAudio. `onSrc` reports the live source node (or null once
// it's done) so each voice can track its own playback handle — no shared
// _activeSrc field, unlike the old VoiceCopilot bookkeeping.
async function playPCM(pcm, rate, config, signal, onSrc) {
  if (!pcm || !pcm.length) return;
  const getCtx = config.getAudioContext;
  const ctx = typeof getCtx === 'function' ? getCtx() : null;
  // No context (or it was closed by stop()) — nothing to play into. Throw so
  // the fallback decorator routes this turn (and, once, every turn after) to
  // the browser voice instead of speaking into the void.
  if (!ctx) throw new Error('no audio context available');
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* ignore */ } }
  // A context still suspended (no user gesture yet, or the resume above was
  // refused) would never fire 'ended' and wedge the turn at 'speaking' —
  // throw instead of awaiting a promise that can never settle.
  if (ctx.state === 'suspended') throw new Error('audio locked (needs a user gesture)');
  if (signal && signal.aborted) throw abortedError();
  const buf = ctx.createBuffer(1, pcm.length, rate);
  buf.copyToChannel(pcm instanceof Float32Array ? pcm : Float32Array.from(pcm), 0);
  await new Promise((resolve, reject) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (onSrc) onSrc(null);
      try { src.stop(); } catch (e) { /* already ended */ }
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(abortedError());
    };
    src.onended = () => {
      if (settled) return;
      settled = true;
      if (onSrc) onSrc(null);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (onSrc) onSrc(src); // let the caller silence it mid-sentence on dispose()
    src.start();
  });
}

// ===== Kokoro ================================================================

// ponytail: Kokoro loads from a CDN only when chosen — no npm dep. Defensive
// about the kokoro-js return shape so a minor API bump won't break it.
//
// Pinned for the same reason as WEBLLM_CDN in llmProviders.js: this is
// third-party code executing in our origin next to the player's saved API key,
// so the version it runs is a decision, not whatever the registry serves today.
async function createKokoroVoice(config) {
  const onStatus = config.onStatus || (() => {});
  const mod = await import(/* @vite-ignore */ 'https://esm.run/kokoro-js@1.2.1');
  const KokoroTTS = mod.KokoroTTS || (mod.default && mod.default.KokoroTTS) || mod.default;
  const model = config.kokoroModel || 'onnx-community/Kokoro-82M-v1.0-ONNX';
  const gpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  // Try the fast path first, then fall back. The WebGPU backend can't run the
  // q8-quantized weights (it needs fp32) and some GPUs fail outright, so if
  // WebGPU/fp32 errors we retry on wasm/q8 before giving up to the browser voice.
  const attempts = [];
  if (config.kokoroDtype) attempts.push({ dtype: config.kokoroDtype, device: gpu ? 'webgpu' : 'wasm' });
  if (gpu) attempts.push({ dtype: 'fp32', device: 'webgpu' });
  attempts.push({ dtype: 'q8', device: 'wasm' });
  let kokoro;
  let lastErr;
  for (const opt of attempts) {
    try {
      onStatus(`(loading Kokoro on ${opt.device}…)`);
      kokoro = await KokoroTTS.from_pretrained(model, opt);
      break;
    } catch (e) { lastErr = e; }
  }
  if (!kokoro) throw lastErr || new Error('Kokoro failed to load');

  const voiceName = config.voice || 'af_heart';
  let activeSrc = null;
  return {
    async speak(text, { signal } = {}) {
      if (!text) return;
      if (signal && signal.aborted) throw abortedError();
      const out = await kokoro.generate(text, { voice: voiceName });
      const pcm = out.audio || out.waveform || (out.data && out.data.audio) || out;
      const rate = out.sampling_rate || out.sampleRate || 24000;
      if (signal && signal.aborted) throw abortedError(); // generation isn't interruptible mid-flight; drop a stale result rather than play it
      return playPCM(pcm, rate, config, signal, (src) => { activeSrc = src; });
    },
    async dispose() { if (activeSrc) { try { activeSrc.stop(); } catch (e) { /* already ended */ } activeSrc = null; } },
  };
}

// ===== Supertonic-3 ==========================================================

// ponytail: Supertonic-3 loads from a CDN/HF only when chosen — no npm dep
// (see supertonicTTS.js for the pinned onnxruntime-web@1.23.0 specifier).
async function createSupertonicVoice(config) {
  const onStatus = config.onStatus || (() => {});
  const voiceId = config.supertonicVoice || (config.voice && /^[FM][1-5]$/.test(config.voice) ? config.voice : 'M2');
  const tts = await createSupertonicTTS({
    voice: voiceId,
    lang: String(config.lang || 'en').split('-')[0] || 'en',
    steps: config.supertonicSteps || 4,
    onStatus: (s) => onStatus(`(supertonic: ${s})`),
  });
  let activeSrc = null;
  return {
    async speak(text, { signal } = {}) {
      if (!text) return;
      if (signal && signal.aborted) throw abortedError();
      const out = await tts.generate(text);
      if (signal && signal.aborted) throw abortedError(); // generation isn't interruptible mid-flight; drop a stale result rather than play it
      return playPCM(out.audio, out.sampleRate, config, signal, (src) => { activeSrc = src; });
    },
    async dispose() { if (activeSrc) { try { activeSrc.stop(); } catch (e) { /* already ended */ } activeSrc = null; } },
  };
}
