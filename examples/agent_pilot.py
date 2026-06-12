"""
SkyBloom — external agent pilot over the WebSocket transport.

The GAME is the WebSocket client; this script is the server it connects to.

  1.  pip install websockets
  2.  python examples/agent_pilot.py
  3.  Open the game with  http://localhost:5173/?agent=ws://localhost:8765
      (or in DevTools:  agentAPI.connectAgent('ws://localhost:8765') )

The game streams fairness-shaped observations (same data an in-page bot
gets: next 3 gates, fog-radius entities, terrain probes — 20 Hz, latency
buffer applied). Send {"type": "act", ...} messages back; they go through
the same 10 Hz action ticks and the same physics as the keyboard. If this
process dies, the game instantly returns control to the human.

Two-tier pattern for LLM/SLM pilots: this reflex loop reacts at frame
rate with simple math, while a slow model (Ollama, llama.cpp, a cloud
API) acts as the PLANNER — it reads the latest observation every few
seconds and adjusts the policy's goals (which race to fly, how
aggressive, when to cast). Inference latency then costs you strategy
freshness, not crashes.
"""

import asyncio
import json

import websockets

HOST, PORT = "localhost", 8765


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def reflex_policy(obs):
    """Same steering law as the in-page SimpleBot — pure function of one
    observation. Replace or extend this; the protocol stays the same."""
    race = obs.get("race")
    if not race or race.get("state") == "idle":
        return {"type": "start-race"}
    if race.get("state") == "finished":
        return {"type": "release"}

    gates = race.get("nextGates") or []
    if not gates:
        return None
    gate = gates[0]

    turn = clamp(gate["bearing"] * 2.2, -1.0, 1.0)
    climb = clamp(gate["elevation"] / 40.0, -1.0, 1.0)
    brake = 0.5 if abs(gate["bearing"]) > 1.1 and gate["dist"] < 260 else 0.0

    # Terrain safety: any probe within 300 units rising above us → climb.
    me = obs["self"]
    for probe in obs["terrain"]["ahead"]:
        if probe["dist"] <= 300 and probe["height"] is not None:
            if probe["height"] > me["altitude"] - 12:
                climb = 1.0
                break

    return {
        "type": "act",
        "payload": {"throttle": 1.0, "brake": brake, "turn": turn, "climb": climb},
    }


async def pilot(websocket):
    print("game connected — flying")
    # >>> SLM planner hook: spawn a task here that, every few seconds,
    # >>> feeds the latest observation to your model and mutates shared
    # >>> goals that reflex_policy reads. The reflex loop never waits.
    async for message in websocket:
        msg = json.loads(message)
        if msg.get("type") == "hello":
            print("hello:", msg.get("payload", {}).get("config"))
            continue
        if msg.get("type") != "observation":
            continue
        command = reflex_policy(msg["payload"])
        if command:
            await websocket.send(json.dumps(command))
    print("game disconnected")


async def main():
    async with websockets.serve(pilot, HOST, PORT):
        print(f"agent pilot listening on ws://{HOST}:{PORT}")
        print("open the game with ?agent=ws://localhost:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
