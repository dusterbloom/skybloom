/**
 * GroundRoamController — roam ALONG THE GROUND (walk / trot / run), not fly.
 *
 * PlayerPhysics pins the player to `max(minAltitude, terrainHeight + 5)`, so
 * holding climb = -1 every tick keeps the vehicle glued to the terrain surface;
 * throttle then moves it forward and turn makes it wander. A proportional speed
 * governor holds a believable pace (full throttle would build to ~140 flight
 * speed). It stays on LAND — veering away from any sea ahead and bailing back if
 * it ever finds itself over water — and SPRINTS while the player holds SPACE.
 * Drives only through window.agentAPI.act().
 */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A space typed into a form field must not toggle sprint.
const isEditableTarget = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export class GroundRoamController {
  /**
   * @param {object} api   window.agentAPI
   * @param {object} opts  { targetSpeed=20 (units/s), seaLevel=0, sprintMul=2.4, intervalMs=100 }
   */
  constructor(api = (typeof window !== 'undefined' ? window.agentAPI : null), opts = {}) {
    this.api = api;
    this.targetSpeed = clamp(opts.targetSpeed != null ? opts.targetSpeed : 20, 3, 120);
    this.seaLevel = Number.isFinite(opts.seaLevel) ? opts.seaLevel : 0;
    this.sprintMul = opts.sprintMul || 2.4;
    // Optional authoritative sprint signal (reads the engine's real Space state);
    // the key listeners below are a fallback when it isn't supplied.
    this._isSprinting = typeof opts.isSprinting === 'function' ? opts.isSprinting : null;
    this.intervalMs = opts.intervalMs || 100;
    this._timer = null;
    this._t = 0;
    this._turnBias = 0;
    this._nextTurnChange = 0;
    this._sprint = false;
    // Hold SPACE to sprint. Read raw key state (movement axes are already taken
    // by the virtual pad, so this never fights the controls).
    this._onKeyDown = (e) => { if (e && e.code === 'Space' && !isEditableTarget(e.target)) this._sprint = true; };
    this._onKeyUp = (e) => { if (e && e.code === 'Space') this._sprint = false; };
  }

  start() {
    if (this._timer) return this;
    // The key listener is only a FALLBACK for when no authoritative isSprinting
    // callback was supplied — don't double-listen when the engine signal exists.
    if (!this._isSprinting && typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
    }
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
    }
    try { if (this.api && this.api.release) this.api.release(); } catch (e) { /* ignore */ }
    return this;
  }

  _tick() {
    const obs = this.api && this.api.observe && this.api.observe();
    if (!obs || !obs.self) return;
    this._t += this.intervalMs / 1000;

    // Wander: a slowly-changing heading bias plus a gentle weave (phase-based,
    // no RNG -> replay-safe).
    if (this._t > this._nextTurnChange) {
      this._turnBias = Math.sin(this._t * 1.3) * 0.6 + Math.sin(this._t * 0.37) * 0.4;
      this._nextTurnChange = this._t + 2;
    }
    let turn = clamp(Math.sin(this._t * 0.5) * 0.25 + this._turnBias * 0.4, -1, 1);

    const climb = -1; // pin to terrain+5 every frame -> hug the ground

    // Sprint while SPACE is held (engine signal if provided, else key listener).
    const sprinting = this._sprint || (this._isSprinting ? !!this._isSprinting() : false);
    const target = sprinting ? Math.max(this.targetSpeed * this.sprintMul, 55) : this.targetSpeed;

    // Proportional speed governor: ease throttle toward target, brake when over.
    const cur = obs.self.speed || 0;
    let throttle, brake = 0;
    if (cur > target) { throttle = 0; brake = clamp((cur - target) / Math.max(target, 6), 0.15, 0.8); }
    else { throttle = clamp((target - cur) / Math.max(target, 6) * 0.5 + 0.12, 0.1, 0.6); }

    // NEVER on water. Probes ahead at/below sea level mean a coast is coming —
    // veer hard and slow; if we somehow ended up over water, turn and push back
    // toward land.
    const sea = this.seaLevel;
    const ahead = (obs.terrain && obs.terrain.ahead) || [];
    let waterAhead = false;
    for (const p of ahead) {
      if (p.dist <= 320 && p.height != null && p.height < sea) { waterAhead = true; break; }
    }
    const overWater = obs.terrain && obs.terrain.below != null && obs.terrain.below < sea;
    if (overWater) {
      turn = 1; throttle = 0.5; brake = 0;          // get back to land
    } else if (waterAhead) {
      turn = 1; throttle = 0.08; brake = 0.35;       // hold the shoreline, don't enter
    }

    // Don't charge a cliff: if terrain rises well above us just ahead, slow + veer.
    const alt = obs.self.altitude;
    for (const p of ahead) {
      if (p.dist <= 130 && p.height != null && p.height > alt + 10) {
        throttle = 0; brake = 0.4;
        turn = clamp(turn + 0.6, -1, 1);
        break;
      }
    }

    this.api.act({ throttle, brake, turn, climb });
  }
}

if (typeof window !== 'undefined') window.GroundRoamController = GroundRoamController;
