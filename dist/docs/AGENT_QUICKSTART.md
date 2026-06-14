# Agent Quickstart

This guide starts from a running SkyBloom tab. For the full schema, see [AGENT_API.md](AGENT_API.md).

## DevTools SimpleBot

Open the game, press **Play**, then paste:

```js
const { SimpleBot } = await import('/src/agents/SimpleBot.js');
const bot = new SimpleBot(window.agentAPI, {
  once: true,
  courseSeed: 1337
});
bot.start();
```

Stop and return control to the human:

```js
bot.stop();
```

## In-Browser LLM Pilot (no server)

Let an LLM fly the carpet — entirely in the page, with no server to run. SimpleBot
flies the 10 Hz floor so the run never crashes out; an LLM advisor sets high-level
biases (racing line / speed / climb) every ~2 s, which the floor blends in. Two
serverless providers:

```js
const { LLMPilot } = await import('/src/agents/LLMPilot.js');

// Cloud: a direct browser fetch to the Claude API. Your key stays in THIS browser.
new LLMPilot(window.agentAPI, {
  config: { provider: 'cloud', apiKey: 'sk-ant-...', model: 'claude-haiku-4-5' },
}).start();

// Local: WebLLM on WebGPU, fully on-device (no key; downloads the model once).
new LLMPilot(window.agentAPI, {
  config: { provider: 'local', model: 'Llama-3.2-1B-Instruct-q4f32_1-MLC' },
}).start();
```

Or just press the **LLM Pilot** button in the Race panel (MENU → Race) — it prompts
once for provider/key/model and remembers them in `localStorage`. The pilot drives
through `window.agentAPI.act()` like any agent, so the run is recorded and
`agentAPI.exportResult()` reports `action-log-present`.

> The cloud key lives client-side — fine for your own research, never a shared key.
> Haiku is the fast/cheap default for the tight loop; Opus is the smartest.

Load the best ghost for the same seed:

```js
const best = agentAPI.getBestReplay(1337);
if (best) agentAPI.loadGhost(best);
agentAPI.startRace(1337);
```

## Strict And Open Configs

Strict profile:

```js
agentAPI.setConfig({
  actionHz: 10,
  observationHz: 20,
  observationLatencyMs: 150
});
```

Open profile:

```js
agentAPI.setConfig({
  actionHz: 20,
  observationHz: 20,
  observationLatencyMs: 0
});
```

Use strict for human-comparable times. Use open for exploratory agent research.

## Minimal In-Page Agent

```js
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
agentAPI.startRace(42);

const timer = setInterval(() => {
  const obs = agentAPI.observe();
  const gate = obs?.race?.nextGates?.[0];
  if (!gate) return;
  if (obs.race.state === 'finished') {
    agentAPI.release();
    clearInterval(timer);
    console.log(agentAPI.exportResult());
    return;
  }
  agentAPI.act({
    throttle: 1,
    brake: Math.abs(gate.bearing) > 1.1 && gate.dist < 260 ? 0.5 : 0,
    turn: clamp(gate.bearing * 2.2),
    climb: clamp(gate.elevation / 40)
  });
}, 100);
```

## WebSocket Agent

Run the Python reference server:

```bash
pip install websockets
python examples/agent_pilot.py
```

Connect from DevTools:

```js
agentAPI.connectAgent('ws://localhost:8765');
```

Or auto-connect on page load:

```text
http://localhost:5173/?agent=ws://localhost:8765
```

Use a local SkyBloom page (`npm run dev`, `npm run preview`, or `npm run play`) for `ws://localhost` agents. A GitHub Pages tab is HTTPS; depending on browser policy, local insecure WebSocket connections may be blocked. For hosted Pages experiments, use a `wss://` agent bridge or run the game locally.

The browser is the WebSocket client. Your agent process receives:

```json
{"type":"observation","payload":{ "...": "same shape as observe()" }}
```

Send actions back:

```json
{"type":"act","payload":{"throttle":1,"turn":0.2,"climb":0}}
```

Other supported messages:

- `{"type":"start-race","seed":123}`
- `{"type":"release"}`
- `{"type":"config","payload":{"actionHz":10,"observationLatencyMs":150}}`

If the socket disconnects, the game releases the virtual pad.

## Export A Result

After a race finishes:

```js
const result = agentAPI.exportResult();
console.log(result.verificationStatus);
console.log(JSON.stringify(result, null, 2));
```

The Race Panel's **Export JSON** button downloads the same object.

Use `verificationStatus` honestly:

- `ghost-only`: path replay only.
- `action-log-present`: path replay plus Agent API action metadata.
- `verified`: not currently produced.
