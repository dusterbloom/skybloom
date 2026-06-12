import * as THREE from 'three';
import { Logger } from '../../utils/Logger.js';
import { System } from '../core/System.js';

/**
 * Carpet Trail System — single center ribbon.
 *
 * One preallocated indexed BufferGeometry (strip topology via a static index
 * buffer) rendered with vertex-colored additive blending. Attributes are
 * rewritten in place every frame and setDrawRange() exposes only the active
 * points — no geometry disposal/recreation during updates, no per-frame
 * allocations, exactly one draw call for the whole trail.
 *
 * Each emitted point stores the carpet's back-center position plus a RIGHT
 * vector derived from the player's rotation INCLUDING bankAngle (applied as
 * roll around the local forward +Z axis, the same convention PlayerModels
 * uses for the carpet's visual bank), so the ribbon visibly twists through
 * banked turns. Width and brightness scale with speed; holding Space (boost /
 * climb) pushes the gold-to-magenta gradient hotter and whiter.
 */
export class CarpetTrailSystem extends System {
  constructor(engine) {
    super(engine, 'carpetTrail');
    this.scene = engine.scene;

    // Emission settings
    this.maxPoints = 60;
    this.contrailLifespan = 3.0; // seconds; matches ring capacity at 20 Hz
    this.minSpeedForEmission = 8;
    this.emissionInterval = 0.05; // 20 points per second
    this.timeSinceLastEmission = 0;

    // Speed -> styling mapping (speed 8 => narrow/dim, 250+ => wide/bright)
    this.minStyleSpeed = 8;
    this.maxStyleSpeed = 250;
    this.minHalfWidth = 0.45;
    this.maxHalfWidth = 1.5; // ~0.9 half-width at mid speeds
    this.minBrightness = 0.3;

    // Palette: gold at the carpet aging into magenta at the tail.
    // Boost blends toward hot near-white.
    this.headColor = new THREE.Color(1.0, 0.8, 0.3);
    this.tailColor = new THREE.Color(0.8, 0.18, 0.85);
    this.boostColor = new THREE.Color(1.0, 0.97, 0.9);

    // Ring buffer of emitted points — records preallocated once, reused forever
    this.points = new Array(this.maxPoints);
    for (let i = 0; i < this.maxPoints; i++) {
      this.points[i] = {
        x: 0, y: 0, z: 0,    // ribbon center (world space)
        rx: 1, ry: 0, rz: 0, // unit right vector incl. bank roll (world space)
        halfWidth: 0,
        brightness: 0,
        boost: 0,
        timestamp: 0
      };
    }
    this.head = 0;  // ring index of the oldest active point
    this.count = 0; // number of active points

    // Live head column: glues the ribbon to the carpet between emission ticks
    this._livePoint = {
      x: 0, y: 0, z: 0,
      rx: 1, ry: 0, rz: 0,
      halfWidth: 0,
      brightness: 0,
      boost: 0,
      timestamp: 0
    };
    this._liveActive = false;

    // Geometry capacity: one 2-vertex column per ring point + 1 live column
    this.maxColumns = this.maxPoints + 1;

    // GPU resources (created once in _initialize, disposed only in destroy)
    this.geometry = null;
    this.positions = null;
    this.colors = null;
    this.positionAttr = null;
    this.colorAttr = null;
    this.trailMaterial = null;
    this.trailMesh = null;

    // Boost input state (public API: PlayerInputSystem calls setSpaceBarState)
    this.spaceBarPressed = false;
    this._boostGlow = 0; // smoothed 0..1 boost intensity

    // Reusable temps — no per-frame allocations
    this._emitEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._center = new THREE.Vector3();
    this._right = new THREE.Vector3();

    // Carpet dimensions (emission anchored at back-center, slightly below deck)
    this.carpetWidth = 5;
    this.carpetLength = 8;
  }

  async _initialize() {
    const maxVerts = this.maxColumns * 2;
    this.positions = new Float32Array(maxVerts * 3);
    this.colors = new Float32Array(maxVerts * 3);

    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);

    // Static index buffer: two triangles per adjacent column pair, built once
    const indices = new Uint16Array((this.maxColumns - 1) * 6);
    for (let i = 0; i < this.maxColumns - 1; i++) {
      const v = i * 2;
      const o = i * 6;
      indices[o] = v;
      indices[o + 1] = v + 1;
      indices[o + 2] = v + 2;
      indices[o + 3] = v + 1;
      indices[o + 4] = v + 3;
      indices[o + 5] = v + 2;
    }
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.trailMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false
    });

    this.trailMesh = new THREE.Mesh(this.geometry, this.trailMaterial);
    this.trailMesh.name = 'carpetTrailRibbon';
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 1;
    this.scene.add(this.trailMesh);

    Logger.info('CarpetTrailSystem initialized (single additive ribbon)');
  }

  _update(delta, elapsed) {
    if (!this.geometry) return;

    const playerState = this.engine.systemManager.get('playerState');
    if (!playerState || !playerState.localPlayer) return;

    const player = playerState.localPlayer;
    const speed = player.velocity.length();

    // Smooth the boost glow so holding Space ramps the ribbon without popping
    const boostTarget = this.spaceBarPressed ? 1 : 0;
    this._boostGlow += (boostTarget - this._boostGlow) * Math.min(1, delta * 6);

    // Emission gating (min speed + fixed interval)
    this.timeSinceLastEmission += delta;
    const emitting = speed > this.minSpeedForEmission;
    if (emitting && this.timeSinceLastEmission >= this.emissionInterval) {
      this.addPoint(player, speed);
      this.timeSinceLastEmission = 0;
    }

    this.cleanupOldPoints();

    // While emitting, a live head column follows the carpet so the ribbon
    // stays attached between emission ticks; when slow, the trail detaches
    // and fades out naturally.
    this._liveActive = emitting && this.count > 0;
    if (this._liveActive) {
      this.computePoint(this._livePoint, player, speed);
    }

    this.updateTrailGeometry();
  }

  /**
   * Fill a preallocated point record from current player state.
   * The right vector includes bankAngle applied as roll around the local
   * forward (+Z) axis — same convention as the carpet model's visual bank,
   * so the ribbon twists in the same direction the carpet rolls.
   */
  computePoint(target, player, speed) {
    const bank = player.bankAngle || 0;
    this._emitEuler.set(
      player.rotation.x,
      player.rotation.y,
      (player.rotation.z || 0) + bank,
      'YXZ'
    );

    // Back-center of the carpet, slightly below the deck
    this._center.set(0, -0.2, -this.carpetLength / 2);
    this._center.applyEuler(this._emitEuler);
    this._center.add(player.position);

    this._right.set(1, 0, 0);
    this._right.applyEuler(this._emitEuler);

    let speedFactor =
      (speed - this.minStyleSpeed) / (this.maxStyleSpeed - this.minStyleSpeed);
    if (speedFactor < 0) speedFactor = 0;
    else if (speedFactor > 1) speedFactor = 1;

    const boost = this._boostGlow;

    target.x = this._center.x;
    target.y = this._center.y;
    target.z = this._center.z;
    target.rx = this._right.x;
    target.ry = this._right.y;
    target.rz = this._right.z;
    target.halfWidth =
      (this.minHalfWidth + (this.maxHalfWidth - this.minHalfWidth) * speedFactor) *
      (1 + 0.25 * boost);
    target.brightness =
      (this.minBrightness + (1 - this.minBrightness) * speedFactor) *
      (1 + 0.5 * boost);
    target.boost = boost;
    target.timestamp = performance.now() / 1000;
  }

  addPoint(player, speed) {
    let slot;
    if (this.count < this.maxPoints) {
      slot = (this.head + this.count) % this.maxPoints;
      this.count++;
    } else {
      // Ring full: recycle the oldest record (its fade is ~0 by then)
      slot = this.head;
      this.head = (this.head + 1) % this.maxPoints;
    }
    this.computePoint(this.points[slot], player, speed);
  }

  cleanupOldPoints() {
    const now = performance.now() / 1000;
    while (
      this.count > 0 &&
      now - this.points[this.head].timestamp > this.contrailLifespan
    ) {
      this.head = (this.head + 1) % this.maxPoints;
      this.count--;
    }
  }

  /**
   * Rewrite position/color attributes in place and set the draw range.
   * Columns are written oldest -> newest, with the live column last.
   * Never disposes or recreates GPU resources.
   */
  updateTrailGeometry() {
    const total = this.count + (this._liveActive ? 1 : 0);
    if (total < 2) {
      // 0 or 1 point: nothing drawable — hide via draw range, no errors
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const now = performance.now() / 1000;
    for (let i = 0; i < this.count; i++) {
      this.writeColumn(i, this.points[(this.head + i) % this.maxPoints], now);
    }
    if (this._liveActive) {
      this.writeColumn(this.count, this._livePoint, now);
    }

    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, (total - 1) * 6);
  }

  writeColumn(columnIndex, p, now) {
    const age = now - p.timestamp;
    let life = 1 - age / this.contrailLifespan;
    if (life < 0) life = 0;
    else if (life > 1) life = 1;

    // The tail tapers in width as well as brightness
    const hw = p.halfWidth * (0.3 + 0.7 * life);

    const pos = this.positions;
    const col = this.colors;
    const vi = columnIndex * 6; // 2 vertices * 3 components per column

    pos[vi] = p.x - p.rx * hw;
    pos[vi + 1] = p.y - p.ry * hw;
    pos[vi + 2] = p.z - p.rz * hw;
    pos[vi + 3] = p.x + p.rx * hw;
    pos[vi + 4] = p.y + p.ry * hw;
    pos[vi + 5] = p.z + p.rz * hw;

    // Gold (fresh) -> magenta (old); boost pulls the hue toward hot white
    const t = 1 - life;
    let r = this.headColor.r + (this.tailColor.r - this.headColor.r) * t;
    let g = this.headColor.g + (this.tailColor.g - this.headColor.g) * t;
    let b = this.headColor.b + (this.tailColor.b - this.headColor.b) * t;
    if (p.boost > 0) {
      const k = 0.6 * p.boost;
      r += (this.boostColor.r - r) * k;
      g += (this.boostColor.g - g) * k;
      b += (this.boostColor.b - b) * k;
    }

    // Additive blending: darker == more transparent, so the age fade and
    // speed/boost brightness are encoded directly into the vertex color.
    // life^2 gives a bright head and a tail that dissolves to nothing.
    const intensity = life * life * p.brightness * (1 + 0.35 * this._boostGlow);
    r *= intensity;
    g *= intensity;
    b *= intensity;

    col[vi] = r;
    col[vi + 1] = g;
    col[vi + 2] = b;
    col[vi + 3] = r;
    col[vi + 4] = g;
    col[vi + 5] = b;
  }

  setSpaceBarState(pressed) {
    this.spaceBarPressed = pressed;
  }

  resetTrail() {
    this.head = 0;
    this.count = 0;
    this._liveActive = false;
    this.timeSinceLastEmission = 0;
    if (this.geometry) {
      this.geometry.setDrawRange(0, 0);
    }
  }

  handleVisibilityChange(isVisible) {
    if (isVisible) {
      this.resetTrail();
    }
  }

  destroy() {
    this.resetTrail();
    if (this.trailMesh) {
      this.scene.remove(this.trailMesh);
      this.trailMesh = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.trailMaterial) {
      this.trailMaterial.dispose();
      this.trailMaterial = null;
    }
  }
}
