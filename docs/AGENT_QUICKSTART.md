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
