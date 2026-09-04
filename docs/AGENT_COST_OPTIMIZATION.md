# Agent cost optimization

SkyBloom runs two LLM workloads against one API key. They want opposite things,
and until now they shared a single model and a single set of request settings.
This is the policy that replaced that, and the reasoning behind each choice.

The rule: **the cheapest model that can do the job, except where a wrong answer
is visible to the player.** Nothing here trades product quality for tokens.

## The two workloads

| | `pilot` (LLMPilot) | `voice` (VoiceCopilot) |
|---|---|---|
| Prompt | ~120 tokens | ~1.4k static + live game state |
| Output | 4 numbers as JSON | a spoken line + up to ~25 world ops |
| Rate | every 2s during a race (~30/min) | human-paced, a few turns a minute |
| Cost of a bad answer | a worse racing line | a broken world edit the player sees |
| Floor if the LLM fails | SimpleBot flies at 10 Hz | none — this *is* the feature |

The pilot is high-frequency and low-stakes; the voice agent is the reverse. One
model for both overpays on the first and underperforms on the second.

## What changed

### 1. Per-task model routing (`src/agents/modelRouting.js`)

`pilot` → `claude-haiku-4-5`. `voice` → `claude-sonnet-5`.

The whole policy is one object (`TASKS`), so changing it is a one-line edit
rather than an archaeology exercise.

### 2. Prompt caching on the voice prefix

The voice system prompt is byte-identical every turn, so it gets a
`cache_control` breakpoint. The breakpoint goes on the **system block**, not on a
message: the message list rotates (only a short history window is kept), so a
message-level breakpoint would be invalidated every turn and never read.
Everything volatile — history, live game state — sits after the breakpoint, which
is where it has to be for a prefix match to hold.

**This is why routing voice *up* is cheaper, not dearer.** Anthropic silently
declines to cache a prefix below a per-model minimum: 4096 tokens on Haiku 4.5,
1024 on Sonnet 5. At ~1.4k tokens the voice prefix caches on Sonnet 5 and does
**not** cache on Haiku 4.5. Cached input bills at ~0.1×:

| | list input | effective cost of the repeated ~1.4k prefix |
|---|---|---|
| Haiku 4.5 (below cache minimum) | $1.00 / MTok | $1.00 / MTok — never cached |
| Sonnet 5 (cached) | $3.00 / MTok | **$0.30 / MTok** |

So the dominant part of each voice turn costs about a third as much on the
smarter model. The uncached remainder (a sentence of speech plus the game-state
line) is small, and output is short.

That is an argument from list prices, not a measurement. `cache_read_input_tokens`
is the ground truth — see the meter below.

### 3. Advisor call elimination (the pilot's real cost)

The pilot's spend was never about model choice — it was calling the advisor on a
fixed 2s timer whether or not the race had moved. Now it computes a quantized
signature of everything the prompt actually carries (gate index, distance,
bearing, elevation, speed) and skips the call when that hasn't changed, with an
8s `maxHoldMs` safety valve so a quantization plateau can't freeze the directive.
It also skips entirely when there's no gate to advise on.

On a synthetic 40s trace (long straight cruise, then a fast closing approach)
this took 21 advisor calls down to 11. The saving scales with how much of a race
is cruising, so treat ~50% as illustrative of that trace, not a guarantee.

### 4. `max_tokens` per task

96 for the pilot, 400 for voice. This is a truncation guard, not a budget — you
are billed for tokens generated, not for the cap. The tight pilot cap stops a
chatty model padding four numbers into prose; the larger voice cap gives a spoken
reply plus a multi-op world array room to land.

### 5. Thinking explicitly disabled where it defaults on

Sonnet 5 and Opus 5 think unless told not to, and **`max_tokens` caps thinking
and reply together**. Routing voice to Sonnet 5 without disabling thinking would
have burned the 400-token budget on reasoning and truncated the spoken line
mid-sentence — a silent break, not an error. Both agents want a fast, short,
structured answer, so `thinking: {type: 'disabled'}` is sent for models whose
catalog entry marks thinking on by default. Haiku 4.5 already defaults off.

## Measuring it (`src/agents/llmBudget.js`)

"Max results per token" is not a claim you can make from a comment. Every cloud
call reports usage to an in-memory meter, shown live in **MENU → Agent**:

```
14 calls · 21.3k in / 1.1k out · 71% cached · $0.03
```

From DevTools:

```js
window.llmBudget.summary()   // per-task tokens + cost
window.llmBudget.line()      // the one-liner shown in the panel
window.llmBudget.reset()
```

Read it like this:

- **`cacheRead` climbing while `input` stays flat** — the static prefix is being
  reused. Working as intended.
- **`cacheRead` stuck at 0 on voice** — the prefix is below the model's cache
  minimum (most likely because a model was pinned manually), or something
  volatile crept into the system prompt ahead of the breakpoint.

Local and OpenAI-compatible brains report tokens and $0 rather than inventing a
price for weights we can't identify.

## Free beats cheap: local server discovery

The cheapest token is the one you don't buy. If the player already runs LM Studio,
Jan, Ollama or llama.cpp, that should be the offer — not a paid API and a key
prompt.

`src/agents/localEndpoints.js` probes the usual ports in parallel
(`GET {baseURL}/models`, the one endpoint every OpenAI-compatible server
implements) and reports which models are loaded:

| Server | Port probed |
|---|---|
| Higgs (this project's own inference server) | 9000 |
| LM Studio | 1234 |
| Jan | 1337 |
| Ollama | 11434 |
| llama.cpp / LocalAI | 8080 |
| vLLM | 8000 |
| text-generation-webui | 5000 |

Plus whatever `Base URL` is currently in the form, so a custom port is never
missed. Measured in Chromium: all seven probes complete in a few tens of ms
whether or not anything is listening (a refused connection is instant). Nothing
waits on it — the form is fully usable while the probes run.

Order is preference: the first server to answer is what gets offered, and Higgs
leads the list. Reorder `KNOWN_ENDPOINTS` to change that; nothing else depends on
it.

What happens with a hit:

- **Never configured anything** → the local server is *applied*, not just offered.
  There is no key to lose and the Brain select reverses it in one click.
- **Already has settings** → a banner offers it: `⚡ Found LM Studio ·
  qwen2.5-7b-instruct on this machine.` with a one-click **Use it — no API key, no
  cost**.
- Either way the server's real model ids become completions on the Model id field,
  so nobody has to guess the exact string.
- The Brain dropdown now reads `cloud API (paid)` / `local server (free)` /
  `on-device (free)` — the cost is visible at the point of choosing.
- If a cloud run is blocked for a missing key, the toast names the free server
  that's already running instead of only demanding a key.

**A probe can fail while the server is genuinely up.** All of these look identical
to a closed port from a browser, which is a security guarantee rather than a bug —
so the UI offers a **Scan for a local server** button rather than concluding
nothing is there:

- **CORS** — the server must allow the page's origin. LM Studio ships with CORS
  on; Ollama needs `OLLAMA_ORIGINS` set.
- **Mixed content** — from an `https://` page, Chrome and Firefox treat
  `http://localhost` as trustworthy and allow it; Safari does not.
- **Private Network Access** — Chrome may preflight public → loopback requests and
  expect `Access-Control-Allow-Private-Network` on the reply.

Local endpoints report tokens and $0 to the meter, since we can't price weights we
can't identify.

## Settings

**MENU → Agent** gains a *Model* mode:

- **auto** (default) — per-task routing, with the resolved models shown beneath.
- **manual** — pin one model id for both agents. `max_tokens`, caching and the
  thinking guard still apply; if you pin a model whose cache minimum is above
  ~1.4k tokens, the voice prefix stops caching and the meter will show it.

Saved configs predating this field default to **auto**: the model they held was
the shipped default, not a deliberate choice. Manual mode is ignored for the
`openai` and `local` providers, where the model id names whatever the local
server has loaded.

## What was deliberately not done

- **Routing voice by per-utterance complexity** (cheap model for chat, smart for
  world edits). A misclassification puts the weak model on exactly the turn that
  needed the strong one — the "dumbass on the critical part" failure. Task-class
  routing has no such failure mode.
- **Trimming the voice system prompt.** It is the cached part; shortening it
  saves ~0.1× on tokens while directly reducing world-authoring accuracy.
- **Batching or deferring pilot calls.** The advisor is latency-sensitive within
  a race; not calling at all beats calling late.
