/**
 * Where each agent's tokens go, and why.
 *
 * SkyBloom runs two very different LLM workloads against the same key, and they
 * want opposite things:
 *
 *   pilot  — LLMPilot's racing advisor. Tiny prompt, tiny answer (four numbers),
 *            called on a timer during a race. SimpleBot flies the 10 Hz floor, so
 *            a weak or late answer costs a slightly worse racing line, never the
 *            run. High frequency, low stakes -> cheapest model that can emit JSON.
 *   voice  — VoiceCopilot's brain. A ~1.4k-token static system prompt describing
 *            ~25 world-authoring ops, open-ended speech in, JSON + world edits out.
 *            Human-paced (a few turns a minute), and a wrong op is a visible
 *            product failure. Low frequency, high stakes -> the smarter model.
 *
 * Spending the same model on both is what wastes money: the pilot overpays per
 * call at 30 calls/minute, and the voice agent underperforms on the one workload
 * where quality is the product.
 *
 * The second lever is prompt caching, and it is model-dependent in a way that is
 * easy to get wrong. Anthropic silently declines to cache a prefix shorter than a
 * per-model minimum — 4096 tokens on Haiku 4.5, but only 1024 on Sonnet 5. The
 * voice system prompt (~1.4k tokens) therefore caches on Sonnet 5 and does NOT
 * cache on Haiku 4.5. Cached input bills at ~0.1x, so the repeated Sonnet 5 prefix
 * costs ~$0.30/MTok against Haiku 4.5's uncached $1.00/MTok: routing voice UP to
 * the smarter model makes the dominant part of each turn cheaper, not dearer.
 * llmBudget measures whether that actually happens — `cache_read_input_tokens`
 * is the ground truth, not this comment.
 */

/**
 * Per-model facts we actually branch on. Prices are USD per million tokens at
 * list rates; `cacheMinTokens` is the shortest prefix Anthropic will cache;
 * `thinkingOnByDefault` marks models that think unless told not to.
 */
export const MODELS = {
  'claude-haiku-4-5': { inputPerMTok: 1.00, outputPerMTok: 5.00, cacheMinTokens: 4096, thinkingOnByDefault: false },
  'claude-sonnet-5': { inputPerMTok: 3.00, outputPerMTok: 15.00, cacheMinTokens: 1024, thinkingOnByDefault: true },
  'claude-opus-5': { inputPerMTok: 5.00, outputPerMTok: 25.00, cacheMinTokens: 512, thinkingOnByDefault: true },
};

/**
 * The routing table — the whole cost policy in one object.
 *
 * `maxTokens` is a truncation guard, not a budget: you're billed for tokens
 * generated, not for the cap. The pilot answers with one small JSON object, so a
 * tight cap just stops a chatty model from padding. Voice needs room for a spoken
 * reply plus an array of world ops.
 */
export const TASKS = {
  pilot: { model: 'claude-haiku-4-5', maxTokens: 96, cache: false },
  voice: { model: 'claude-sonnet-5', maxTokens: 400, cache: true },
};

const FALLBACK_TASK = { model: 'claude-haiku-4-5', maxTokens: 200, cache: false };

/**
 * Turn the saved agent settings into the concrete per-call config a provider needs.
 *
 * Auto mode (the default) picks the model from the task; manual mode honours
 * whatever model id the user typed, including ids we know nothing about. Only the
 * cloud provider is routed — `openai` and `local` model ids name a local server's
 * loaded weights, so we pass those through untouched and never claim a price.
 *
 * @param {'pilot'|'voice'} task
 * @param {object} config  Saved agent config ({provider, apiKey, model, modelMode, …}).
 * @returns {object} config plus {model, maxTokens, cache, thinking, task}.
 */
export function resolveTask(task, config = {}) {
  const spec = TASKS[task] || FALLBACK_TASK;
  const resolved = { ...config, task, maxTokens: spec.maxTokens, cache: false, thinking: null };

  if (config.provider && config.provider !== 'cloud') {
    // Local / OpenAI-compatible: the user's model string is the only thing that
    // can be right here, and none of the cloud-side levers apply.
    return resolved;
  }

  const manual = config.modelMode === 'manual' && config.model;
  resolved.model = manual ? config.model : spec.model;

  const known = MODELS[resolved.model];
  // Caching is free to ask for: a prefix below the model's minimum simply isn't
  // cached (no error, no write premium), so mark it and let the meter report.
  resolved.cache = !!spec.cache;
  // Sonnet 5 and Opus 5 think unless told not to, and max_tokens caps thinking
  // AND reply together — leaving it on would burn the budget and truncate the
  // spoken line mid-sentence. Both agents want a fast, short, structured answer.
  if (known && known.thinkingOnByDefault) resolved.thinking = { type: 'disabled' };

  return resolved;
}

/** Models offered in the settings dropdown, cheapest first. */
export function cloudModelChoices() {
  return Object.keys(MODELS);
}

/** What auto mode would pick for a task — used to label the settings UI. */
export function autoModelFor(task) {
  return (TASKS[task] || FALLBACK_TASK).model;
}
