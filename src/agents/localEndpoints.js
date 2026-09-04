/**
 * Find an OpenAI-compatible LLM server the player is already running.
 *
 * The cheapest token is the one you don't buy. If LM Studio, Jan, Ollama or
 * llama.cpp is up on this machine, it should be the offer — not a paid API and a
 * key prompt. Everything here is a best-effort probe from the page: it either
 * finds a server quickly or gives up quietly, and it must never block the UI.
 *
 * Probe = GET {baseURL}/models, the one endpoint every OpenAI-compatible server
 * implements. A hit also tells us which models are loaded, so the settings form
 * can offer real ids instead of asking the player to type one.
 *
 * Why a probe can fail even though the server IS running — worth knowing before
 * you debug a false negative:
 *   - CORS. The server has to allow this page's origin. LM Studio ships with CORS
 *     on; Ollama needs OLLAMA_ORIGINS set. A blocked request is indistinguishable
 *     from a closed port here, which is a browser guarantee, not a bug.
 *   - Mixed content. From an https:// page, an http://localhost request is a
 *     special case: Chrome and Firefox treat loopback as trustworthy and allow
 *     it, Safari does not.
 *   - Private Network Access. Chrome may send a preflight for public -> loopback
 *     requests and expect Access-Control-Allow-Private-Network on the reply.
 * All of these surface as "not found", so the UI offers a rescan rather than
 * claiming nothing is there.
 */

/**
 * Default ports, preferred first. Order matters: the first one to answer is what
 * gets offered (and auto-adopted for a player who has configured nothing), so
 * Higgs — this project's own inference server — leads, then Apple FM, which
 * ranks second for the same reason Higgs leads: on a macOS 26+ machine with
 * `fm serve` running it needs zero setup, no key and no model download — it's
 * already there. Then LM Studio, which is the most common third-party server
 * and the one whose defaults let a browser reach it unconfigured.
 * Move a row to change the preference; nothing else reads this order.
 *
 * An entry may also carry `preferModels: [id, ...]` — see preferredModel()
 * below — for servers whose model list isn't already sorted best-first.
 */
export const KNOWN_ENDPOINTS = [
  { name: 'Higgs', baseURL: 'http://localhost:9000/v1' },
  // fm serve lists `system` (on-device) before `pcc` (Private Cloud Compute),
  // but pcc measured faster AND far more reliable — preferModels overrides
  // that array order rather than silently defaulting to the weaker model.
  { name: 'Apple FM', baseURL: 'http://localhost:1976/v1', preferModels: ['pcc', 'system'] },
  { name: 'LM Studio', baseURL: 'http://localhost:1234/v1' },
  { name: 'Jan', baseURL: 'http://localhost:1337/v1' },
  { name: 'Ollama', baseURL: 'http://localhost:11434/v1' },
  { name: 'llama.cpp / LocalAI', baseURL: 'http://localhost:8080/v1' },
  { name: 'vLLM', baseURL: 'http://localhost:8000/v1' },
  { name: 'text-generation-webui', baseURL: 'http://localhost:5000/v1' },
];

// Generous on purpose. A closed port refuses instantly, so this budget is only
// ever spent on a port that hangs — and it has to survive the main thread being
// blocked by engine start-up, which can delay both the fetch resolution and the
// abort timer. A tight timeout here silently loses a server that did reply.
const DEFAULT_TIMEOUT_MS = 4000;

/**
 * Ask one endpoint what it is. Resolves to {name, baseURL, models} or null —
 * never rejects, because "this port isn't a model server" is the normal case
 * for most of the list and isn't worth a stack trace.
 *
 * Also doubles as the model-list fetch for the hosted free presets (Groq,
 * OpenRouter) — same endpoint shape (`GET {baseURL}/models`), just remote and,
 * for Groq, keyed. `apiKey` is the ONLY addition for that: Groq's /models
 * returns 401 without one, which already resolves to null here (a plain
 * !res.ok), so the keyless local-server path is completely unaffected.
 *
 * @param {{name?:string, baseURL:string}} candidate
 * @param {{timeoutMs?:number, signal?:AbortSignal, apiKey?:string}} [opts]
 */
export async function probeEndpoint(candidate, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, apiKey } = {}) {
  const baseURL = String(candidate && candidate.baseURL || '').trim();
  if (!baseURL) return null;
  const url = baseURL.replace(/\/+$/, '') + '/models';

  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  // A caller-supplied signal cancels the probe too (panel closed mid-scan).
  const onOuterAbort = () => { if (ctrl) ctrl.abort(); };
  if (signal) {
    if (signal.aborted) { if (timer) clearTimeout(timer); return null; }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const opts = { method: 'GET' };
    if (ctrl) opts.signal = ctrl.signal;
    if (apiKey) opts.headers = { authorization: `Bearer ${apiKey}` };
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    const data = await res.json();
    // OpenAI shape is {data:[{id}]}; be tolerant of servers that return a bare list.
    const list = Array.isArray(data && data.data) ? data.data : (Array.isArray(data) ? data : []);
    const models = list.map((m) => (typeof m === 'string' ? m : m && m.id)).filter(Boolean);
    // Carry the candidate's model preference (if any) onto the result, so
    // preferredModel() can honour it without re-deriving which endpoint this was.
    const found = { name: candidate.name || hostLabel(baseURL), baseURL, models };
    if (Array.isArray(candidate.preferModels)) found.preferModels = candidate.preferModels;
    return found;
  } catch (e) {
    return null; // closed port, CORS, mixed content, timeout — all the same to us
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Probe every known port in parallel and return the ones that answered, in
 * KNOWN_ENDPOINTS order so the caller can just take [0] as the recommendation.
 *
 * @param {{timeoutMs?:number, signal?:AbortSignal, extra?:string}} [opts]
 *        `extra` is a baseURL to check first — the one already in the settings
 *        form, so a custom port the player configured is never missed.
 */
export async function discoverLocalEndpoints({ timeoutMs = DEFAULT_TIMEOUT_MS, signal, extra } = {}) {
  const candidates = [...KNOWN_ENDPOINTS];
  const extraURL = String(extra || '').trim();
  if (extraURL && !candidates.some((c) => sameEndpoint(c.baseURL, extraURL))) {
    candidates.unshift({ name: hostLabel(extraURL), baseURL: extraURL });
  }
  const results = await Promise.all(
    candidates.map((c) => probeEndpoint(c, { timeoutMs, signal })),
  );
  return results.filter(Boolean);
}

/**
 * The model a found endpoint should be used with.
 *
 * Default is "its first loaded model" — fine when a server's /models order is
 * already best-first. Some servers' order is NOT a quality ranking (Apple FM
 * lists on-device `system` before the far more reliable `pcc`), so an endpoint
 * can carry `preferModels: [id, ...]` — see KNOWN_ENDPOINTS — naming ids in
 * priority order. The first one the endpoint actually reports wins; if none of
 * the preferred ids are present (or there's no preference at all), this falls
 * back to models[0]. Pure function of `found`, so it's trivially unit-testable
 * without a network probe.
 */
export function preferredModel(found) {
  if (!found) return 'local-model';
  const models = found.models || [];
  if (Array.isArray(found.preferModels)) {
    const hit = found.preferModels.find((id) => models.includes(id));
    if (hit) return hit;
  }
  return models[0] || 'local-model';
}

/**
 * Short human label for a discovered endpoint, e.g. "LM Studio · qwen2.5-7b".
 * Names preferredModel()'s pick, not just models[0] — otherwise the "Found …"
 * banner could name a different model than the one Adopt actually configures
 * (e.g. showing Apple FM's `system` while adoption sets `pcc`).
 */
export function describeEndpoint(found) {
  if (!found) return '';
  const model = preferredModel(found);
  return model && model !== 'local-model' ? `${found.name} · ${model}` : found.name;
}

function sameEndpoint(a, b) {
  return String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '');
}

function hostLabel(baseURL) {
  try { return new URL(baseURL).host; } catch (e) { return 'local server'; }
}
