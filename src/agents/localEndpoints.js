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
 * Higgs — this project's own inference server — leads, then LM Studio, which is
 * the most common and the one whose defaults let a browser reach it unconfigured.
 * Move a row to change the preference; nothing else reads this order.
 */
export const KNOWN_ENDPOINTS = [
  { name: 'Higgs', baseURL: 'http://localhost:9000/v1' },
  { name: 'LM Studio', baseURL: 'http://localhost:1234/v1' },
  { name: 'Jan', baseURL: 'http://localhost:1337/v1' },
  { name: 'Ollama', baseURL: 'http://localhost:11434/v1' },
  { name: 'llama.cpp / LocalAI', baseURL: 'http://localhost:8080/v1' },
  { name: 'vLLM', baseURL: 'http://localhost:8000/v1' },
  { name: 'text-generation-webui', baseURL: 'http://localhost:5000/v1' },
];

const DEFAULT_TIMEOUT_MS = 1500;

/**
 * Ask one endpoint what it is. Resolves to {name, baseURL, models} or null —
 * never rejects, because "this port isn't a model server" is the normal case
 * for most of the list and isn't worth a stack trace.
 *
 * @param {{name?:string, baseURL:string}} candidate
 * @param {{timeoutMs?:number, signal?:AbortSignal}} [opts]
 */
export async function probeEndpoint(candidate, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
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
    const res = await fetch(url, ctrl ? { method: 'GET', signal: ctrl.signal } : { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    // OpenAI shape is {data:[{id}]}; be tolerant of servers that return a bare list.
    const list = Array.isArray(data && data.data) ? data.data : (Array.isArray(data) ? data : []);
    const models = list.map((m) => (typeof m === 'string' ? m : m && m.id)).filter(Boolean);
    return { name: candidate.name || hostLabel(baseURL), baseURL, models };
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

/** The model a found endpoint should be used with: its first loaded model. */
export function preferredModel(found) {
  if (!found) return 'local-model';
  return (found.models && found.models[0]) || 'local-model';
}

/** Short human label for a discovered endpoint, e.g. "LM Studio · qwen2.5-7b". */
export function describeEndpoint(found) {
  if (!found) return '';
  const model = found.models && found.models[0];
  return model ? `${found.name} · ${model}` : found.name;
}

function sameEndpoint(a, b) {
  return String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '');
}

function hostLabel(baseURL) {
  try { return new URL(baseURL).host; } catch (e) { return 'local server'; }
}
