/**
 * Token and cost meter for the in-browser agents.
 *
 * "Max results per token" is not a claim you can make from a comment — you need
 * the number. Every cloud call reports its usage here, so the Agent settings
 * panel can show what the pilot and the voice co-pilot each actually cost, and
 * whether prompt caching is landing (`cacheRead` climbing while `input` stays
 * flat means the static prefix is being reused; `cacheRead` stuck at 0 means it
 * is not, and the prefix is probably under the model's cache minimum).
 *
 * In-memory only: it resets with the page, and it never sees the API key.
 *
 * DevTools:
 *   window.llmBudget.summary()
 */
import { MODELS } from './modelRouting.js';

// Anthropic's cache multipliers against the model's base input price.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute TTL

const zeroTally = () => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUSD: 0 });

class LLMBudget {
  constructor() {
    this.reset();
  }

  reset() {
    this.byTask = {};
    this.total = zeroTally();
    this.listeners = new Set();
    return this;
  }

  /** Subscribe to updates; returns an unsubscribe function. */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Record one completion. `usage` is Anthropic's usage object; anything missing
   * counts as zero, so a provider that reports nothing still counts the call.
   * @param {string} task   'pilot' | 'voice' | …
   * @param {string} model  Model id, used to price the call.
   * @param {object} usage  {input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}
   */
  record(task, model, usage) {
    const u = usage || {};
    const input = num(u.input_tokens);
    const output = num(u.output_tokens);
    const cacheRead = num(u.cache_read_input_tokens);
    const cacheWrite = num(u.cache_creation_input_tokens);

    // Only price models we have list rates for. A local model or an unknown id
    // counts tokens and reports $0 rather than inventing a number.
    const price = MODELS[model];
    const costUSD = price
      ? ((input + cacheRead * CACHE_READ_MULTIPLIER + cacheWrite * CACHE_WRITE_MULTIPLIER) * price.inputPerMTok
        + output * price.outputPerMTok) / 1e6
      : 0;

    const key = task || 'other';
    const tally = this.byTask[key] || (this.byTask[key] = zeroTally());
    for (const t of [tally, this.total]) {
      t.calls += 1;
      t.input += input;
      t.output += output;
      t.cacheRead += cacheRead;
      t.cacheWrite += cacheWrite;
      t.costUSD += costUSD;
    }
    tally.model = model;
    this._emit();
    return this;
  }

  /** Snapshot for display: per-task tallies plus the total. */
  summary() {
    const byTask = {};
    for (const [k, v] of Object.entries(this.byTask)) byTask[k] = { ...v };
    return { byTask, total: { ...this.total } };
  }

  /** One-line readout for the settings panel / toasts. */
  line() {
    const t = this.total;
    if (!t.calls) return 'no LLM calls yet';
    const cached = t.cacheRead + t.input > 0
      ? Math.round((t.cacheRead / (t.cacheRead + t.input)) * 100)
      : 0;
    return `${t.calls} calls · ${fmtTokens(t.input + t.cacheRead + t.cacheWrite)} in / ${fmtTokens(t.output)} out · ${cached}% cached · ${fmtUSD(t.costUSD)}`;
  }

  _emit() {
    for (const fn of this.listeners) {
      try { fn(this); } catch (e) { /* a bad listener must not break a turn */ }
    }
  }
}

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }

function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtUSD(n) {
  if (!n) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export const llmBudget = new LLMBudget();

if (typeof window !== 'undefined') window.llmBudget = llmBudget;
