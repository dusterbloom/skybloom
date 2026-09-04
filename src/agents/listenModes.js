/**
 * listenModes.js — the mic-input strategy behind VoiceCopilot#listen()/
 * stopListening(). One interface, the house factory shape (see createProvider
 * in llmProviders.js, createVoice in voiceProviders.js):
 *   const mic = createMicInput(config);
 *   mic.start(); mic.stop(); mic.setMode('handsfree'); mic.destroy();
 *
 * VoiceCopilot owns none of the raw `webkitSpeechRecognition` handling any
 * more — it lives here, behind two modes:
 *
 *   'ptt'       — push-to-talk. One utterance (interimResults off, continuous
 *                 off), then the recognizer stops itself. This is exactly
 *                 today's behaviour and stays the DEFAULT — it's what the Talk
 *                 button drives, and what a fresh/unset config resolves to.
 *   'handsfree' — continuous = true, interimResults = true: the mic stays
 *                 open across turns instead of needing a press per utterance.
 *                 Interim text streams out via onInterim() as the player
 *                 talks; onUtterance() fires once OUR OWN endpointer (see
 *                 isLikelyComplete() below) decides the thought is finished —
 *                 not whenever the browser's own silence detector happens to
 *                 emit a "final" result, which is exactly the kind of cut-off
 *                 this file exists to avoid.
 *
 * Restart-loop safety (hands-free only): Chrome stops continuous recognition
 * on its own after a stretch of silence and on assorted internal timeouts, so
 * onend has to restart it for "hands-free" to actually mean hands-free. Left
 * unchecked that's a hot loop — a broken mic/permission state would spin
 * start/end/start/end forever, a battery-and-CPU bug on a real machine — so
 * restarts back off (capped): the delay only resets to its base once a
 * session shows real evidence of working (a result arrived, or it simply
 * stayed up a few seconds) — NOT just because start() was accepted, which
 * proves nothing about the exact failure mode this backoff exists for: a
 * session that starts fine and then ends immediately, over and over. A
 * permission denial (not-allowed / service-not-allowed, which will never
 * succeed on retry) disables the mode for good and reports it once through
 * onError instead of looping on it at all.
 */

// Two endpointing windows, not one. Silence-only endpointing (fire N ms after
// the mic goes quiet, always the same N) either cuts people off mid-thought
// ("take me to the… uh… crystal formation" -> fires after the first pause,
// sends "take me to the") or, if N is made generous enough to avoid that,
// makes every SHORT command feel laggy. Two windows, chosen per-transcript by
// isLikelyComplete(), get most of the value of real endpointing without a
// model: fire fast on what looks finished, wait longer on what looks cut off.
export const SHORT_SILENCE_MS = 700;  // reads like a finished clause/command -> fire fast, feels responsive
export const LONG_SILENCE_MS = 1600;  // trails on a conjunction/filler/preposition/article -> extend, don't truncate

// Hands-free restart backoff (see the file header). Growth is multiplicative,
// capped; RESTART_HEALTHY_MS is how long a session has to stay up — with no
// result required — before ending counts as unremarkable rather than a sign
// something's broken.
const RESTART_BASE_MS = 300;
const RESTART_GROWTH = 1.8;
const RESTART_MAX_MS = 5000;
const RESTART_HEALTHY_MS = 3000;

// Words a transcript ending on strongly suggests the speaker isn't done:
// conjunctions ("and then I want to…"), fillers ("go to the… um"),
// prepositions/articles ("take me to the…"), and a handful of dangling verbs/
// intensifiers that read the same way ("it's very…"). Not exhaustive by
// design — this is a cheap ends-with heuristic, not a parser.
const DANGLING_WORDS = new Set([
  // conjunctions / connectors
  'and', 'but', 'or', 'so', 'then', 'because', 'although', 'though', 'while', 'if', 'when', 'as',
  // fillers
  'um', 'umm', 'uh', 'uhh', 'er', 'ah', 'like', 'well',
  // prepositions
  'to', 'at', 'in', 'on', 'of', 'for', 'with', 'from', 'by', 'about', 'into', 'over', 'under', 'near', 'towards', 'toward',
  // articles / determiners / possessives
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'our', 'its',
  // dangling copulas / intensifiers that read as unfinished
  'is', 'are', 'was', 'were', 'be', 'very', 'really', 'just', 'not', 'so',
]);

/**
 * Pure. Cheap approximation of "did the speaker just finish a thought?" —
 * looks only at how the transcript ENDS. No model, no downloads.
 *   - empty / whitespace-only          -> false (nothing to fire on either way)
 *   - ends on a word from DANGLING_WORDS, or a trailing comma -> false (extend
 *     the silence window; a comma or "…and" is a speaker still composing)
 *   - anything else, including very short transcripts ("go", "stop", "yes")
 *     -> true (fire fast — a short command is complete, not a fragment; the
 *     dangling-word check above is what keeps a lone "the" or "um" from also
 *     firing fast)
 */
export function isLikelyComplete(transcript) {
  const t = String(transcript || '').trim();
  if (!t) return false;
  if (/,\s*$/.test(t)) return false;
  const words = t.split(/\s+/);
  const last = words[words.length - 1].toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '');
  if (DANGLING_WORDS.has(last)) return false;
  return true;
}

function browserSR() {
  return (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * createMicInput(config) -> { start(), stop(), setMode(mode), destroy(), get mode() }
 * config: { mode: 'ptt'|'handsfree', lang, onUtterance(text), onInterim(text),
 *           onState(s), onError(kind) }
 * onState reports raw recognizer lifecycle: 'listening' | 'idle' | 'error'.
 * onError reports a kind string: 'unsupported' (no SpeechRecognition in this
 * browser at all) or whatever DOM error code the recognizer raised
 * ('not-allowed', 'service-not-allowed', 'no-speech', 'network', ...).
 */
export function createMicInput(config = {}) {
  const lang = config.lang || 'en-US';
  const onUtterance = config.onUtterance || (() => {});
  const onInterim = config.onInterim || (() => {});
  const onState = config.onState || (() => {});
  const onError = config.onError || (() => {});
  let mode = config.mode === 'handsfree' ? 'handsfree' : 'ptt'; // 'ptt' is the default — see file header

  const SR = browserSR();

  let rec = null;
  let active = false;        // a recognizer session is currently running
  let userStopped = true;    // stop()ped on purpose — onend must NOT auto-restart
  let disabled = false;      // permission denied — permanently off, never retried
  let restartTimer = null;
  let restartDelayMs = RESTART_BASE_MS; // hands-free auto-restart backoff — see onend's "healthy" check below for when this resets
  let sessionStartedAt = 0;    // when the current recognizer session started, for the "stayed up a few seconds" health signal
  let gotResultThisSession = false; // when a 'result' event arrived, for the other health signal
  let endpointTimer = null;
  let committedFinal = '';   // finalized fragments accumulated since the last fired utterance

  function clearEndpointTimer() {
    if (endpointTimer) { clearTimeout(endpointTimer); endpointTimer = null; }
  }

  function resetUtteranceBuffer() {
    committedFinal = '';
    clearEndpointTimer();
  }

  // (Re)start the semantic-endpoint timer against the latest combined
  // transcript — called on every result event, so it behaves like a debounce
  // whose delay depends on how the transcript currently ends.
  function scheduleEndpoint(combined) {
    clearEndpointTimer();
    const wait = isLikelyComplete(combined) ? SHORT_SILENCE_MS : LONG_SILENCE_MS;
    endpointTimer = setTimeout(() => fireUtterance(combined), wait);
  }

  function fireUtterance(text) {
    clearEndpointTimer();
    resetUtteranceBuffer();
    onInterim(''); // clear the provisional line before the real one lands
    const t = (text || '').trim();
    if (t) onUtterance(t);
  }

  function handlePttResult(e) {
    const t = e.results[0] && e.results[0][0] && e.results[0][0].transcript;
    if (t) { gotResultThisSession = true; onUtterance(t); }
  }

  function handleHandsfreeResult(e) {
    let liveInterim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const t = (res[0] && res[0].transcript) || '';
      if (!t) continue;
      if (res.isFinal) committedFinal = committedFinal ? `${committedFinal} ${t.trim()}` : t.trim();
      else liveInterim += t;
    }
    const combined = (committedFinal + (liveInterim ? ` ${liveInterim}` : '')).trim();
    if (!combined) return;
    gotResultThisSession = true; // real evidence this session is actually hearing something — see onend's health check
    onInterim(combined);
    scheduleEndpoint(combined);
  }

  function makeRecognizer() {
    const r = new SR();
    r.lang = lang;
    r.maxAlternatives = 1;
    r.continuous = mode === 'handsfree';
    r.interimResults = mode === 'handsfree';

    // Every handler below first checks `r === rec` — `rec` is reassigned to
    // the newest recognizer on every (re)start (see startRecognizer()), so
    // this guards against a STALE callback from an already-superseded
    // instance. That's not paranoia: a barge-in (VoiceCopilot#bargeIn(), the
    // V hotkey) can abort mid-speech and open a brand-new recognizer while the
    // OLD one's stop() is still winding down — its onend still fires
    // (asynchronously) afterward, and without this guard it would go on to
    // call onState('idle') or even schedule its own restart, stomping on the
    // new recognizer's state or racing it.
    r.onresult = mode === 'handsfree' ? handleHandsfreeResult : handlePttResult;
    const rawOnResult = r.onresult;
    r.onresult = (e) => { if (r === rec) rawOnResult(e); };

    r.onerror = (e) => {
      if (r !== rec) return;
      const kind = (e && e.error) || 'unknown';
      if (kind === 'not-allowed' || kind === 'service-not-allowed') {
        // Permission denials never succeed on retry — stop for good instead
        // of hammering the user with repeat prompts or spinning a restart loop.
        disabled = true;
        userStopped = true;
        active = false;
        resetUtteranceBuffer();
        onError(kind);
        return;
      }
      onError(kind); // transient (no-speech, network, aborted, audio-capture, ...) — onend below decides what happens next
    };

    r.onend = () => {
      if (r !== rec) return;
      active = false;
      if (mode === 'handsfree' && !userStopped && !disabled) {
        // Chrome ends continuous recognition on its own; restart it so
        // hands-free stays hands-free. Backed off (and capped) so a
        // persistently broken mic can't turn this into a hot loop — see the
        // file header. The backoff resets to its base only when THIS session
        // showed real evidence of working (a result arrived, or it simply
        // stayed up RESTART_HEALTHY_MS without ending) — start() not having
        // thrown is not that evidence, so a session that starts fine and then
        // ends immediately, over and over, still gets the growing delay.
        const healthy = gotResultThisSession || (Date.now() - sessionStartedAt) >= RESTART_HEALTHY_MS;
        if (healthy) restartDelayMs = RESTART_BASE_MS;
        const wait = restartDelayMs;
        restartTimer = setTimeout(() => {
          restartTimer = null;
          restartDelayMs = Math.min(restartDelayMs * RESTART_GROWTH, RESTART_MAX_MS);
          startRecognizer();
        }, wait);
      } else {
        resetUtteranceBuffer();
        onState('idle');
      }
    };

    return r;
  }

  function startRecognizer() {
    if (disabled || !SR) return;
    try {
      rec = makeRecognizer();
      rec.start();
      active = true;
      sessionStartedAt = Date.now();
      gotResultThisSession = false;
      onState('listening');
    } catch (e) {
      active = false;
      onError('start-failed');
    }
  }

  return {
    start() {
      if (!SR) { onError('unsupported'); return; }
      if (disabled) return;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      // A genuine external call (Talk/V, a mode switch) is a fresh, deliberate
      // session, not a retry after failure — reset the backoff here so a
      // delay that grew from earlier trouble doesn't leak into it. The
      // internal auto-restart path (onend, above) is the only place that
      // must NOT get this reset for free.
      restartDelayMs = RESTART_BASE_MS;
      userStopped = false;
      if (active) return; // already listening — a redundant start() is a no-op, not a restart
      startRecognizer();
    },
    stop() {
      userStopped = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      resetUtteranceBuffer();
      onInterim(''); // never leave a ghost provisional line behind
      if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } }
      active = false;
    },
    setMode(m) {
      const next = m === 'handsfree' ? 'handsfree' : 'ptt';
      if (next === mode) return;
      const wasActive = active && !userStopped;
      mode = next;
      if (wasActive) { this.stop(); this.start(); }
    },
    destroy() {
      this.stop();
      rec = null;
    },
    get mode() { return mode; },
  };
}
