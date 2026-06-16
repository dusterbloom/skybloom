/**
 * GenieAgent — turns a natural-language WISH into world-authoring ops.
 *
 * Mirrors LLMPilot's proven shape: a pluggable provider (cloud Haiku /
 * OpenAI-compatible Qwen / on-device WebLLM) returns ONE JSON object, which a
 * tolerant parser validates and then dispatches to window.worldAPI. The verb
 * vocabulary is tiny (~4 ops) on purpose, so Haiku-tier and Qwen-27B/35B models
 * hit it reliably — exactly like the pilot's directive schema.
 *
 * Usage:
 *   const g = new GenieAgent(window.worldAPI, { config:{ provider:'openai',
 *               baseURL:'http://localhost:1234/v1', model:'qwen3-30b' } });
 *   await g.wish('build me three pyramids and bring a duck');
 */
import { createProvider } from './llmProviders.js';

const SYSTEM = `You are the Genie of a flying-carpet world. Turn the user's wish into world-editing ops.
Reply with ONLY one JSON object, no prose:
{"ops":[ ... ], "say":"<=12 words"}
Each op is one of:
  {"op":"spawn","shape":"pyramid|box|sphere|cylinder|cone|falcon|paperplane","count":1-20,"scale":<world units, ~100 default>,"color":"<css color optional>","at":"ahead|here"}
  // falcon flaps its wings, paperplane banks as it glides — use these for lively flyers
  {"op":"spawn","catalog":"<existing entry name>","count":1-20,"scale":100,"at":"ahead"}
  {"op":"import","repo":"khronos","name":"<asset, e.g. Duck, Fox, Avocado, DamagedHelmet>"}
  {"op":"clear"}
Rules: prefer "shape" for geometric things (pyramids, cubes, towers). Use "import" only for named real objects from the repo. Default at="ahead". Keep counts sane.`;

export class GenieAgent {
  /**
   * @param {object} api    window.worldAPI (the GenieSystem surface).
   * @param {object} opts   { config:{provider,...}, onSay(text), onOps(ops) }
   */
  constructor(api = (typeof window !== 'undefined' ? window.worldAPI : null), opts = {}) {
    this.api = api;
    this.config = opts.config || {};
    this.onSay = opts.onSay || (() => {});
    this.onOps = opts.onOps || (() => {});
    this._provider = null;
  }

  async _ensureProvider() {
    if (!this._provider) this._provider = await createProvider(this.config);
    return this._provider;
  }

  /** Run a wish end to end: ask the model, parse, dispatch. Returns the plan. */
  async wish(text) {
    if (!this.api) throw new Error('GenieAgent: window.worldAPI not found. Is the game running?');
    const provider = await this._ensureProvider();

    const known = (this.api.list ? this.api.list() : []).map((e) => e.name);
    const ctx = known.length ? `\nExisting catalogue entries you may spawn: ${known.join(', ')}.` : '';

    const raw = await provider.complete([
      { role: 'system', content: SYSTEM + ctx },
      { role: 'user', content: text },
    ]);

    const plan = parsePlan(raw);
    if (!plan) { this.onSay("I couldn't picture that — try again?"); return null; }
    if (plan.say) this.onSay(plan.say);
    this.onOps(plan.ops);
    await this._dispatch(plan.ops);
    return plan;
  }

  async _dispatch(ops) {
    for (const op of ops) {
      try {
        if (op.op === 'spawn') await this.api.spawn(op);
        else if (op.op === 'import') await this.api.import(op);
        else if (op.op === 'clear') this.api.clear();
        else if (op.op === 'remove') this.api.remove(op);
      } catch (err) { /* one bad op shouldn't abort the rest of the wish */ }
    }
  }
}

const OPS = new Set(['spawn', 'import', 'clear', 'remove']);

/** Tolerant parse: accept prose around the JSON, then keep only valid ops. */
export function parsePlan(text) {
  if (!text) return null;
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { /* give up */ } }
  }
  if (!obj || typeof obj !== 'object') return null;
  const rawOps = Array.isArray(obj.ops) ? obj.ops : (OPS.has(obj.op) ? [obj] : []);
  const ops = rawOps.filter((o) => o && typeof o.op === 'string' && OPS.has(o.op));
  if (!ops.length) return null;
  return { ops, say: typeof obj.say === 'string' ? obj.say.slice(0, 120) : '' };
}

if (typeof window !== 'undefined') window.GenieAgent = GenieAgent;
