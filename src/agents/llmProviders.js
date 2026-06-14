/**
 * Pluggable, server-LESS LLM providers for the in-browser pilot and voice co-pilot.
 * One interface:
 *   const p = await createProvider(config);
 *   const text = await p.complete([{ role:'system'|'user'|'assistant', content:'...' }], { signal });
 *
 * Three backends, all run in the page — no server YOU host:
 *   - cloud  : direct browser fetch to the Claude Messages API (your key, local).
 *   - openai : any OpenAI-compatible /chat/completions endpoint — LM Studio, Jan,
 *              Ollama, vLLM, llama.cpp, etc. (often a localhost server you already run).
 *   - local  : WebLLM on WebGPU, fully on-device (no key, offline).
 */

// ponytail: WebLLM is loaded from a CDN via dynamic import ONLY when chosen — so
// there's no npm dependency and no bundle cost otherwise. Upgrade path: pin it
// with `npm i @mlc-ai/web-llm` if you want it offline-cached.
const WEBLLM_CDN = 'https://esm.run/@mlc-ai/web-llm';

export async function createProvider(config = {}) {
  switch (config.provider) {
    case 'local': return createLocalProvider(config);
    case 'openai': return createOpenAIProvider(config);
    default: return createCloudProvider(config);
  }
}

// Direct browser → Claude. The `anthropic-dangerous-direct-browser-access` header
// opts the request into CORS from a page; it also signals the key lives client-side,
// which is fine for personal/research use but must never be a shared key.
function createCloudProvider({ apiKey, model = 'claude-haiku-4-5' } = {}) {
  if (!apiKey) throw new Error('Cloud provider needs an Anthropic API key.');
  return {
    async complete(messages, { signal } = {}) {
      // Anthropic takes `system` as a top-level field, not a message role — split it
      // out so callers can use the same role:'system' shape across every provider.
      const system = messages.filter((m) => m && m.role === 'system').map((m) => m.content).join('\n\n');
      const msgs = messages.filter((m) => m && m.role !== 'system');
      const body = { model, max_tokens: 200, messages: msgs };
      if (system) body.system = system;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Claude API ${res.status}${await errDetail(res)}`);
      const data = await res.json();
      const block = Array.isArray(data.content) && data.content.find((b) => b.type === 'text');
      return block ? block.text : '';
    },
  };
}

// Any OpenAI-compatible chat endpoint. Works with hosted OpenAI and — the common
// case here — a local server (LM Studio default :1234, Jan :1337, Ollama :11434/v1,
// vLLM, llama.cpp). Most local servers ignore the key; send it only if provided.
function createOpenAIProvider({ baseURL = 'http://localhost:1234/v1', apiKey = '', model = 'local-model' } = {}) {
  const url = baseURL.replace(/\/+$/, '') + '/chat/completions';
  return {
    async complete(messages, { signal } = {}) {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({ model, messages, max_tokens: 200, temperature: 0.4 }),
      });
      if (!res.ok) throw new Error(`OpenAI-compat ${res.status}${await errDetail(res)}`);
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    },
  };
}

async function createLocalProvider({ model = 'Llama-3.2-1B-Instruct-q4f32_1-MLC', onStatus } = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('Local (WebLLM) provider needs WebGPU (try Chrome). Use cloud or openai instead.');
  }
  const webllm = await import(/* @vite-ignore */ WEBLLM_CDN);
  const engine = await webllm.CreateMLCEngine(model, {
    initProgressCallback: (p) => onStatus && onStatus(p && p.text ? p.text : 'loading model…'),
  });
  return {
    async complete(messages) {
      const reply = await engine.chat.completions.create({ messages, max_tokens: 200, temperature: 0.4 });
      return reply?.choices?.[0]?.message?.content || '';
    },
  };
}

async function errDetail(res) {
  try { const m = (await res.json())?.error?.message; return m ? `: ${m}` : ''; } catch (e) { return ''; }
}
