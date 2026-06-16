import * as THREE from 'three';
import { System } from '../core/System.js';
import { Logger } from '../../utils/Logger.js';
import { GenieCatalog } from '../../agents/GenieCatalog.js';

/**
 * GenieSystem — the genie's hands. Exposes `window.worldAPI`, a CREATIVE-mode
 * world-authoring surface that is deliberately SEPARATE from the fairness-bound
 * `window.agentAPI` (which may only drive the carpet like a human). The genie
 * is allowed to add/remove meshes and swap the vehicle; it never writes to the
 * verified-replay/racing pipeline, so creative edits can't taint a fair run.
 *
 * Every artifact — imported (.glb from a curated repo) or generated (primitive)
 * — is normalized and SAVED into the persistent GenieCatalog, so the genie
 * remembers everything it has ever made and can re-spawn it offline.
 *
 * Verb surface (window.worldAPI):
 *   spawn({ catalog?|shape?, at?, scale?, count?, color?, name? })  -> ids
 *   import({ repo, name, as? })                                      -> entry
 *   remove({ id? })            // last, or a specific spawn id
 *   clear()                    // remove everything the genie spawned
 *   list()                     // catalogue entries
 *   repos()                    // available import repos
 *
 * `at` accepts 'ahead' (default — in front of the player, dropped on terrain),
 * 'here', or an explicit [x,y,z].
 */

// Cesium sample models live in per-model folders with their own filenames, so
// friendly names map to "folder/file" paths rather than a uniform template.
const CESIUM_BASE = 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models';
const CESIUM_PATHS = {
  plane: 'CesiumAir/Cesium_Air',
  drone: 'CesiumDrone/CesiumDrone',
  car: 'GroundVehicle/GroundVehicle',
};

// Curated, CORS-friendly model repos. The agent picks a repo+name; the system
// owns the URL so a small model can never wander into a CORS wall. {name} is
// substituted into the template.
const REPOS = {
  // Khronos official sample assets (raw GitHub, permissive CORS). Ships a
  // queryable manifest (148 models w/ tags) — so the genie can DISCOVER what's
  // importable instead of guessing names. The manifest gives each model's real
  // glb filename per variant, which we use rather than assuming `${name}.glb`.
  khronos: {
    label: 'Khronos glTF Sample Assets',
    base: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models',
    manifest: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/model-index.json',
    examples: ['Duck', 'Avocado', 'BoxAnimated', 'Fox', 'DamagedHelmet'],
  },
  // three.js example models — small, CC, and crucially ANIMATED: the birds
  // ship a looping flight clip, so imported they actually flap (unlike most
  // static Khronos assets). CORS-open from threejs.org. No manifest; the
  // examples list is the menu (and fixes case, e.g. "flamingo" -> "Flamingo").
  threejs: {
    label: 'three.js examples (animated)',
    url: (name) => `https://threejs.org/examples/models/gltf/${name}.glb`,
    examples: ['Flamingo', 'Parrot', 'Stork', 'Horse'],
  },
  // Cesium sample models — animated aircraft/vehicles (CORS-open raw GitHub).
  // Friendly names map to their folder/file paths; the plane's propeller, the
  // drone's rotors and the car's wheels all animate on import.
  cesium: {
    label: 'Cesium sample models (animated)',
    url: (name) => `${CESIUM_BASE}/${CESIUM_PATHS[String(name).toLowerCase()] || name}.glb`,
    examples: ['plane', 'drone', 'car'],
  },
  // Bundled assets shipped with the game (no manifest; name maps to a path).
  local: {
    label: 'Bundled assets (/assets/models)',
    url: (name) => `/assets/models/${name}.glb`,
    examples: ['carpet', 'mana'],
  },
};

// Primitive factories — the "create from scratch" path. Each returns a Mesh.
const PRIMITIVES = {
  pyramid: (color) => new THREE.Mesh(
    new THREE.ConeGeometry(0.72, 1, 4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }),
  ),
  box: (color) => new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  ),
  sphere: (color) => new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 24, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 }),
  ),
  cylinder: (color) => new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  ),
  cone: (color) => new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1, 24),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  ),
};

// Procedurally-animated flyers. Each builder returns { object, update(elapsed) }
// — a self-contained rig whose update() runs every frame, so it actually MOVES
// (static imported meshes just hang in the air). Built from scratch, so there's
// no dependency on finding a rigged bird online (there isn't a reliable one).
const RIGS = {
  // A falcon whose wings flap. Wings live on pivot groups at the shoulders so a
  // single z-rotation sweeps them up and down convincingly.
  falcon: (color) => {
    const c = color || 0x6b4f3a;
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true });
    const beak = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.7, flatShading: true });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.2, 8), mat);
    body.rotation.x = Math.PI / 2;            // nose points forward (+Z)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat);
    head.position.z = 0.62;
    const bill = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), beak);
    bill.rotation.x = Math.PI / 2; bill.position.z = 0.78;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.5), mat);
    tail.position.z = -0.68;
    g.add(body, head, bill, tail);
    const wing = (side) => {
      const pivot = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.55), mat);
      blade.position.x = side * 0.6;          // extends out from the shoulder
      pivot.add(blade);
      g.add(pivot);
      return pivot;
    };
    const L = wing(-1), R = wing(1);
    const update = (t) => {
      const flap = Math.sin(t * 9) * 0.8;     // ~1.4 Hz wingbeat
      L.rotation.z = flap; R.rotation.z = -flap;
    };
    return { object: g, update };
  },
  // A folded paper dart that banks gently as it glides — the low-poly everyman.
  paperplane: (color) => {
    const mat = new THREE.MeshStandardMaterial({ color: color || 0xf3f3f0, roughness: 0.55, side: THREE.DoubleSide, flatShading: true });
    const g = new THREE.Group();
    // Two angled wing halves meeting at a center crease, nose at +Z.
    const v = [
      0, 0.05, 0.9,  -0.7, -0.05, -0.7,  0, -0.12, -0.6,   // left half
      0, 0.05, 0.9,   0, -0.12, -0.6,   0.7, -0.05, -0.7,   // right half
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const wings = new THREE.Mesh(geo, mat);
    const fin = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',
      new THREE.Float32BufferAttribute([0, 0.05, 0.9, 0, -0.12, -0.6, 0, 0.28, -0.55], 3)), mat);
    fin.geometry.computeVertexNormals();
    g.add(wings, fin);
    const update = (t) => { g.rotation.z = Math.sin(t * 1.8) * 0.18; }; // lazy bank
    return { object: g, update };
  },
};

// Default playback rate for embedded glTF clips — 1.0 = the clip's authored
// speed, which looks best for the three.js birds. A per-call animSpeed can
// still slow or quicken any individual spawn/vehicle.
const DEFAULT_ANIM_SPEED = 1.0;

// Choose which embedded glTF clip to loop — prefer active locomotion in priority
// order (a fox should Run, not Survey/idle, which would look static while moving).
const CLIP_PRIORITY = ['gallop', 'run', 'trot', 'fly', 'flap', 'soar', 'glide', 'swim', 'walk', 'move', 'hover', 'idle', 'survey', 'pose', 'stand'];
function pickClip(clips) {
  if (!clips || !clips.length) return null;
  for (const key of CLIP_PRIORITY) {
    const m = clips.find((c) => c && new RegExp(key, 'i').test(c.name || ''));
    if (m) return m;
  }
  return clips[0];
}

// Decide WHICH clips to play. Characters ship rival locomotion states
// (Walk/Run/Survey) — blending them all looks broken, so play just one. But
// mechanical models ship independent part clips (two propellers, four rotors,
// wheels) that should ALL run together. Heuristic: 2+ locomotion-named clips
// => single best; otherwise => every clip.
function selectClips(clips) {
  if (!clips || !clips.length) return [];
  const loco = /idle|run|gallop|walk|survey|jump|attack|death|dance|sit|stand|pose/i;
  const locoClips = clips.filter((c) => c && loco.test(c.name || ''));
  if (locoClips.length >= 2) { const best = pickClip(clips); return best ? [best] : []; }
  return clips;
}

export class GenieSystem extends System {
  constructor(engine) {
    super(engine, 'genie');
    this.catalog = new GenieCatalog();
    this._group = null;       // all genie-spawned objects live under one group
    this._spawns = new Map(); // id -> THREE.Object3D
    this._nextId = 1;
    this._api = null;
    this._animated = new Set(); // objects with userData.genieAnim, ticked each frame
    this._roamer = null;        // active GroundRoamController (walk/run on the ground)
  }

  // Tick every animated rig / glTF mixer so conjured flyers actually move.
  _update(delta, elapsed) {
    if (!this._animated.size) return;
    for (const obj of this._animated) {
      const a = obj && obj.userData && obj.userData.genieAnim;
      if (!a) { this._animated.delete(obj); continue; }
      try {
        if (a.mixer) a.mixer.update(delta);
        if (a.update) a.update(elapsed, delta);
      } catch (err) { this._animated.delete(obj); }
    }
  }

  async _initialize() {
    this._group = new THREE.Group();
    this._group.name = 'GenieSpawns';
    if (this.engine && this.engine.scene) this.engine.scene.add(this._group);

    try { await this.catalog.init(); } catch (err) {
      Logger.warn('GenieSystem: catalogue persistence unavailable —', err && err.message);
    }

    // AUGMENT the shared creative surface rather than replace it. WorldSystem
    // already owns window.worldAPI (terrain/atmosphere godmode that the voice
    // copilot drives); the genie adds object-authoring verbs alongside it, so
    // there is one creative API with both terrain edits and conjured objects.
    // (Still deliberately separate from the fairness-bound window.agentAPI.)
    this._verbs = {
      spawn: this.spawn.bind(this),
      import: this.import.bind(this),
      discover: this.discover.bind(this),
      vehicle: this.vehicle.bind(this),
      roam: this.roam.bind(this),
      stopRoam: this.stopRoam.bind(this),
      trail: this.trail.bind(this),
      remove: this.remove.bind(this),
      clear: this.clear.bind(this),
      listCatalog: () => this.catalog.list(),
      list: () => this.catalog.list(), // alias used by GenieAgent
      repos: () => Object.keys(REPOS).map((k) => ({ id: k, label: REPOS[k].label, examples: REPOS[k].examples })),
    };
    if (typeof window !== 'undefined') {
      const surface = window.worldAPI || (window.worldAPI = {});
      Object.assign(surface, this._verbs);
      this._api = surface;
    }

    Logger.info('GenieSystem initialized — window.worldAPI augmented with spawn/import/clear');
  }

  // =====================================================================
  // SPAWN — from a catalogue entry, or a fresh primitive (which is saved).
  // =====================================================================

  /**
   * spawn({ catalog?, shape?, at?, scale?, count?, color?, name? }) -> string[]
   * Provide `catalog` (existing entry name) OR `shape` (a primitive). Returns
   * the spawn ids created. Resolves async because catalogue/gltf reads may be.
   */
  async spawn(opts = {}) {
    try {
      const count = clampInt(opts.count, 1, 50, 1);
      const scale = num(opts.scale, 0.01, 100000, 100);
      const color = parseColor(opts.color);

      // Resolve the catalogue entry to instantiate from. For a fresh primitive,
      // build+measure+SAVE once; for a catalogue name, just look it up.
      let entry = null;

      if (opts.catalog && this.catalog.has(opts.catalog)) {
        entry = this.catalog.get(opts.catalog);
      } else if (opts.shape && (PRIMITIVES[opts.shape] || RIGS[opts.shape])) {
        // Create-from-scratch: measure a sample, then SAVE the spec (not the mesh).
        const isRig = !!RIGS[opts.shape];
        const sample = isRig ? RIGS[opts.shape](color).object : PRIMITIVES[opts.shape](color);
        const norm = measureNormalize(sample);
        const entryName = this.catalog.uniqueName(opts.name || opts.shape);
        entry = await this.catalog.save({
          name: entryName,
          kind: isRig ? 'rig' : 'primitive',
          source: 'generated',
          primitive: { shape: opts.shape, color },
          normalize: norm,
          createdAt: this._now(),
        });
      } else {
        Logger.warn('GenieSystem.spawn: need a known `catalog` name or `shape`.', opts);
        return [];
      }

      const entryName = entry.name;
      const ids = [];
      for (let i = 0; i < count; i++) {
        // A fresh, independently-normalized object per instance — no shared
        // template to mutate, so scale never compounds across clones.
        const obj = await this._objectFromEntry(entry);
        obj.scale.multiplyScalar(scale);
        this._applyAnimSpeed(obj, opts.animSpeed);
        this._placeObject(obj, opts.at, i, count, scale);
        const id = `g${this._nextId++}`;
        obj.userData.genieId = id;
        obj.userData.genieEntry = entryName;
        if (obj.userData.genieAnim) this._animated.add(obj);
        this._group.add(obj);
        this._spawns.set(id, obj);
        ids.push(id);
      }
      Logger.info(`GenieSystem: spawned ${ids.length}x "${entryName}"`);
      return ids;
    } catch (err) {
      Logger.error('GenieSystem.spawn failed:', err);
      return [];
    }
  }

  // =====================================================================
  // IMPORT — fetch a .glb from a curated repo, normalize, SAVE, spawn once.
  // =====================================================================

  /** import({ repo, name, as? }) -> the saved catalogue entry (or null). */
  async import(opts = {}) {
    try {
      const repoId = opts.repo || 'khronos';
      const repo = REPOS[repoId];
      if (!repo) { Logger.warn('GenieSystem.import: unknown repo', repoId); return null; }
      if (!opts.name) { Logger.warn('GenieSystem.import: name required'); return null; }

      // Resolve the asset URL — via the repo's manifest (fuzzy-matched, real
      // filename) when it has one, else the repo's direct path template.
      const resolved = await this._resolveAsset(repoId, opts.name);
      if (!resolved) { Logger.warn(`GenieSystem.import: "${opts.name}" not found in ${repoId}.`); return null; }
      const { url, name: matchedName } = resolved;
      Logger.info(`GenieSystem: importing "${matchedName}" from ${repoId} …`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);
      const glb = await res.arrayBuffer();

      // Parse once to measure for normalization (and to fail early on bad data).
      const { scene } = await this._parseGLB(glb);
      const norm = measureNormalize(scene);

      const entryName = this.catalog.uniqueName(opts.as || matchedName);
      const entry = await this.catalog.save({
        name: entryName,
        kind: 'gltf',
        source: url,
        glb,
        normalize: norm,
        createdAt: this._now(),
      });

      // Drop the freshly imported model in front of the player immediately.
      await this.spawn({ catalog: entryName, at: 'ahead', scale: 100 });
      return { name: entry.name, kind: entry.kind, source: entry.source };
    } catch (err) {
      Logger.error('GenieSystem.import failed:', err);
      return null;
    }
  }

  // =====================================================================
  // DISCOVER — let the model query what's importable, instead of guessing.
  // =====================================================================

  /**
   * discover({ repo='khronos', query?, tag?, limit=25 }) -> [{ name, tags }]
   * Fetches the repo's manifest (cached) and filters by a name substring and/or
   * a tag. Only models that actually ship a downloadable .glb are returned.
   * Repos without a manifest fall back to their hand-listed examples.
   */
  async discover(opts = {}) {
    try {
      const repoId = opts.repo || 'khronos';
      const repo = REPOS[repoId];
      if (!repo) return [];
      const limit = clampInt(opts.limit, 1, 200, 25);
      const q = (opts.query || '').toString().trim().toLowerCase();
      const tag = (opts.tag || '').toString().trim().toLowerCase();

      const manifest = await this._loadManifest(repoId);
      if (!manifest) {
        return (repo.examples || []).filter((n) => !q || n.toLowerCase().includes(q))
          .slice(0, limit).map((name) => ({ name, tags: [] }));
      }
      const out = [];
      for (const m of manifest) {
        if (!m || !m.name || !this._binaryVariant(m)) continue; // need a .glb
        const name = m.name;
        const tags = Array.isArray(m.tags) ? m.tags : [];
        if (q && !name.toLowerCase().includes(q)) continue;
        if (tag && !tags.some((t) => String(t).toLowerCase() === tag)) continue;
        out.push({ name, tags });
        if (out.length >= limit) break;
      }
      return out;
    } catch (err) { Logger.error('GenieSystem.discover failed:', err); return []; }
  }

  /** Fetch + cache a repo manifest (array of model descriptors). null if none. */
  async _loadManifest(repoId) {
    const repo = REPOS[repoId];
    if (!repo || !repo.manifest) return null;
    if (!this._manifests) this._manifests = {};
    if (this._manifests[repoId] !== undefined) return this._manifests[repoId];
    try {
      const res = await fetch(repo.manifest);
      const json = res.ok ? await res.json() : null;
      this._manifests[repoId] = Array.isArray(json) ? json : null;
    } catch (err) {
      this._manifests[repoId] = null; // cache the failure so we don't refetch every import
    }
    return this._manifests[repoId];
  }

  /** The glb filename for a manifest entry, or null if it has no binary variant. */
  _binaryVariant(m) {
    const v = m && m.variants;
    return v && typeof v['glTF-Binary'] === 'string' ? v['glTF-Binary'] : null;
  }

  /**
   * Resolve a requested name to { url, name } for a repo. Manifest repos
   * fuzzy-match (exact > startsWith > includes, case-insensitive) and build the
   * URL from the model's real variant filename. Non-manifest repos use their
   * path template directly.
   */
  async _resolveAsset(repoId, requested) {
    const repo = REPOS[repoId];
    if (!repo) return null;
    const want = String(requested).trim().toLowerCase();
    const manifest = await this._loadManifest(repoId);
    if (!manifest) {
      if (!repo.url) return null;
      // Fuzzy-match the examples list so "flamingo"/"bird" -> "Flamingo" (server
      // paths are case-sensitive); fall back to the requested name verbatim.
      const ex = repo.examples || [];
      const m = ex.find((n) => n.toLowerCase() === want)
        || ex.find((n) => n.toLowerCase().startsWith(want))
        || ex.find((n) => n.toLowerCase().includes(want));
      const name = m || requested;
      return { url: repo.url(name), name };
    }
    const withGlb = manifest.filter((m) => this._binaryVariant(m));
    const match =
      withGlb.find((m) => m.name.toLowerCase() === want) ||
      withGlb.find((m) => m.name.toLowerCase().startsWith(want)) ||
      withGlb.find((m) => m.name.toLowerCase().includes(want));
    if (!match) return null;
    const file = this._binaryVariant(match);
    return { url: `${repo.base}/${match.name}/glTF-Binary/${file}`, name: match.name };
  }

  // =====================================================================
  // VEHICLE — fly a catalogue object instead of the carpet (visual swap).
  // =====================================================================

  /**
   * vehicle({ set:'carpet' | <catalogue name>, scale? }) -> boolean
   * Replaces the local player's visible model. PlayerModels.updateModels() then
   * keeps it glued to the player's position/heading/bank every frame, so the new
   * mesh flies with the exact same controls. 'carpet' (or no arg) restores the
   * original by clearing the model so updateModels rebuilds it.
   *
   * v1 is a VISUAL swap — flight physics are unchanged. A per-vehicle flight
   * profile (bank/stall/hover) is a separate, additive follow-up.
   */
  async vehicle(opts = {}) {
    try {
      const ps = this._sys('playerState');
      const lp = ps && ps.localPlayer;
      if (!lp) { Logger.warn('GenieSystem.vehicle: no local player yet.'); return false; }
      const scene = this.engine && this.engine.scene;

      const set = (opts && opts.set) || 'carpet';
      // Detach the current model from the scene (don't dispose — carpet meshes
      // share templated materials; GC handles the discarded clone).
      if (lp.model && scene) scene.remove(lp.model);
      this._animated.delete(lp.model);   // stop ticking the old vehicle's rig

      const trail = this._sys('carpetTrail');

      if (set === 'carpet') {
        lp.model = null;          // updateModels() recreates the carpet next frame
        this.stopRoam();          // back to the carpet -> stop ground roaming, restore trail
        if (trail && trail.resetEmitOffset) trail.resetEmitOffset();
        this._vehicle = 'carpet';
        Logger.info('GenieSystem.vehicle: restored the carpet');
        return true;
      }

      const entry = this.catalog.get(set);
      if (!entry) { Logger.warn(`GenieSystem.vehicle: "${set}" not in catalogue.`); return false; }

      const obj = await this._objectFromEntry(entry);
      // Default to a ~20-unit silhouette: thin models (a bird seen from behind)
      // read far smaller than the flat carpet at the same camera distance, so a
      // bigger default frames them comfortably. Override with opts.scale.
      obj.scale.multiplyScalar(num(opts.scale, 1, 100, 20));
      this._applyAnimSpeed(obj, opts.animSpeed);

      // The catalogue normalize sits a model's BASE at y=0 (good for ground
      // spawns), but a vehicle should be CENTERED on the player anchor the
      // camera frames — otherwise its body floats above and looks far away.
      // Measure the scaled model, then wrap it and shift it so its center is
      // at the wrapper's origin; updateModels() drives the wrapper.
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      obj.position.sub(center);                 // body center -> origin
      const vehicle = new THREE.Group();
      vehicle.add(obj);
      vehicle.userData.genieVehicle = set;
      if (obj.userData.genieAnim) {             // tick the wrapper; mixer lives on obj
        vehicle.userData.genieAnim = obj.userData.genieAnim;
        this._animated.add(vehicle);
      }
      // Anchor the trail to the body's back edge (now centered at origin), just
      // under the belly — so the stream starts at the model, not too tight.
      if (trail && trail.setEmitOffset) {
        trail.setEmitOffset(0, -size.y * 0.15, -size.z * 0.5);
      }
      lp.model = vehicle;         // updateModels() will position/rotate it each frame
      if (scene) scene.add(vehicle);
      this._vehicle = set;
      Logger.info(`GenieSystem.vehicle: now flying "${set}"`);
      return true;
    } catch (err) { Logger.error('GenieSystem.vehicle failed:', err); return false; }
  }

  // =====================================================================
  // ROAM — make the CURRENT vehicle walk/run along the ground (not fly).
  // =====================================================================

  /**
   * roam({ mode?:'walk'|'trot'|'run'|'graze'|'prowl', speed? }) -> boolean
   * Starts a ground-roam on the local player so a swapped vehicle (e.g. a fox)
   * trots over the terrain instead of flying. Silences the flight trail while
   * grounded. Call stopRoam() (or roam again) to change pace.
   */
  async roam(opts = {}) {
    try {
      const agentAPI = (typeof window !== 'undefined') ? window.agentAPI : null;
      if (!agentAPI) { Logger.warn('GenieSystem.roam: window.agentAPI not ready.'); return false; }
      const speeds = { graze: 6, walk: 10, trot: 20, prowl: 16, run: 38 };
      const mode = (opts && opts.mode) || 'trot';
      const targetSpeed = (opts && opts.speed != null) ? opts.speed : (speeds[mode] || 20);

      // Keep the animal on land — feed the world's sea level so it veers off coasts.
      const world = this._sys('world');
      const seaLevel = (world && Number.isFinite(world.waterLevel)) ? world.waterLevel : 0;

      // Authoritative sprint signal: the engine's real Space key state.
      const isSprinting = () => {
        const im = this.engine && this.engine.input;
        return !!(im && typeof im.isKeyDown === 'function' && im.isKeyDown('Space'));
      };

      this.stopRoam(); // replace any existing roamer
      const { GroundRoamController } = await import('../../agents/GroundRoamController.js');
      this._roamer = new GroundRoamController(agentAPI, { targetSpeed, seaLevel, isSprinting });
      this._roamer.start();
      this.trail({ on: false }); // a ground animal shouldn't trail a flight contrail
      Logger.info(`GenieSystem.roam: ${mode} (target ${Math.round(targetSpeed)})`);
      return true;
    } catch (err) { Logger.error('GenieSystem.roam failed:', err); return false; }
  }

  /** Stop ground roaming and hand control back; restores the flight trail. */
  stopRoam() {
    try {
      if (this._roamer) { this._roamer.stop(); this._roamer = null; }
      this.trail({ on: true });
      return true;
    } catch (err) { Logger.error('GenieSystem.stopRoam failed:', err); return false; }
  }

  /** Toggle the flight trail (the carpet "stream"). trail({on:false}) silences it. */
  trail(opts = {}) {
    try {
      const ct = this._sys('carpetTrail');
      if (ct && typeof ct.setEmitEnabled === 'function') {
        ct.setEmitEnabled(opts && opts.on !== undefined ? !!opts.on : true);
        return true;
      }
      return false;
    } catch (err) { Logger.error('GenieSystem.trail failed:', err); return false; }
  }

  // =====================================================================
  // REMOVE / CLEAR
  // =====================================================================

  remove(opts = {}) {
    try {
      let id = opts && opts.id;
      if (!id) { // default: most recent spawn
        const keys = Array.from(this._spawns.keys());
        id = keys[keys.length - 1];
      }
      const obj = id && this._spawns.get(id);
      if (!obj) return false;
      this._disposeObject(obj);
      this._spawns.delete(id);
      return true;
    } catch (err) { Logger.error('GenieSystem.remove failed:', err); return false; }
  }

  clear() {
    try {
      for (const obj of this._spawns.values()) this._disposeObject(obj);
      this._spawns.clear();
      return true;
    } catch (err) { Logger.error('GenieSystem.clear failed:', err); return false; }
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /**
   * Build a fresh THREE object from a catalogue entry (gltf or primitive),
   * wrapped in a Group so the stored normalize transform applies cleanly:
   * the inner object is offset to sit centered with its base at y=0, the wrapper
   * carries the unit-scale. The wrapper's own position/scale is then free for
   * placement and the per-instance world scale.
   */
  async _objectFromEntry(entry) {
    let inner;
    let anim = null;
    if (entry.kind === 'gltf') {
      const { scene, animations } = await this._parseGLB(entry.glb);
      inner = scene;
      // Drive any embedded clip so rigged imports (Fox's gallop, etc.) move.
      if (animations && animations.length) {
        const mixer = new THREE.AnimationMixer(inner);
        // Play every part clip (two propellers, four rotors…); for characters
        // selectClips returns just one so rival gaits don't blend.
        for (const clip of selectClips(animations)) mixer.clipAction(clip).play();
        // Many source clips (the three.js Flamingo especially) beat fast; ease
        // the default and let a per-entry/per-call animSpeed override it.
        mixer.timeScale = num(entry.animSpeed, 0.05, 4, DEFAULT_ANIM_SPEED);
        anim = { mixer };
      }
    } else if (entry.kind === 'rig') {
      const built = (RIGS[entry.primitive && entry.primitive.shape] || RIGS.falcon)(parseColor(entry.primitive && entry.primitive.color));
      inner = built.object;
      anim = { update: built.update };
    } else {
      const factory = PRIMITIVES[entry.primitive && entry.primitive.shape] || PRIMITIVES.box;
      inner = factory(parseColor(entry.primitive && entry.primitive.color));
    }
    const group = new THREE.Group();
    group.add(inner);
    applyNormalize(group, inner, entry.normalize);
    if (anim) group.userData.genieAnim = anim;
    return group;
  }

  /** Parse a GLB ArrayBuffer into { scene, animations } via the shared loader. */
  _parseGLB(glb) {
    return new Promise((resolve, reject) => {
      const loader = this.engine && this.engine.assets && this.engine.assets.gltfLoader;
      if (!loader) { reject(new Error('GLTFLoader unavailable')); return; }
      // parse() takes the raw ArrayBuffer; '' path = no external resources.
      loader.parse(glb.slice(0), '', (gltf) => resolve({
        scene: gltf.scene || (gltf.scenes && gltf.scenes[0]),
        animations: gltf.animations || [],
      }), reject);
    });
  }

  /** Position an object per the `at` directive. */
  _placeObject(obj, at, index, count, scale) {
    const p = this._resolveAnchor(at);
    // Fan multiple instances out in a shallow arc so they don't z-fight.
    if (count > 1) {
      const spread = Math.max(scale * 2.5, 30);
      const offset = (index - (count - 1) / 2) * spread;
      p.x += offset;
    }
    // Drop onto terrain if we can probe it — but never below the sea, so objects
    // land on the ground OR rest on the water surface, not drowned under it.
    const world = this._sys('world');
    if (world && typeof world.getTerrainHeight === 'function') {
      const h = world.getTerrainHeight(p.x, p.z);
      if (Number.isFinite(h)) {
        const sea = Number.isFinite(world.waterLevel) ? world.waterLevel : 0;
        p.y = Math.max(h, sea);
      }
    }
    obj.position.set(p.x, p.y, p.z);
  }

  /** Resolve 'ahead' | 'here' | [x,y,z] into a world position. */
  _resolveAnchor(at) {
    const player = this._localPlayer();
    if (Array.isArray(at) && at.length === 3) {
      return new THREE.Vector3(num(at[0], -1e6, 1e6, 0), num(at[1], -1e6, 1e6, 0), num(at[2], -1e6, 1e6, 0));
    }
    if (!player || !player.position) return new THREE.Vector3(0, 0, 0);
    const px = player.position.x, py = player.position.y, pz = player.position.z;
    if (at === 'here') return new THREE.Vector3(px, py, pz);
    // 'ahead' (default): 200 units along the player's heading (+Z forward).
    const yaw = player.rotation ? player.rotation.y : 0;
    const dist = 200;
    return new THREE.Vector3(px + Math.sin(yaw) * dist, py, pz + Math.cos(yaw) * dist);
  }

  _localPlayer() {
    const ps = this._sys('playerState');
    return ps ? ps.localPlayer : null;
  }

  /** Override an animated object's clip playback rate (null = keep default). */
  _applyAnimSpeed(obj, animSpeed) {
    if (animSpeed === undefined || animSpeed === null) return;
    const a = obj && obj.userData && obj.userData.genieAnim;
    if (a && a.mixer) a.mixer.timeScale = num(animSpeed, 0.05, 4, DEFAULT_ANIM_SPEED);
  }

  _disposeObject(obj) {
    if (this._group) this._group.remove(obj);
    this._animated.delete(obj);
    obj.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((m) => m && m.dispose && m.dispose());
      }
    });
  }

  _sys(name) {
    const sm = this.engine && this.engine.systemManager;
    return sm && typeof sm.get === 'function' ? sm.get(name) : null;
  }

  // Clock isolated here so it's easy to make deterministic later; primitives
  // and imports only use it for a createdAt timestamp, never for logic.
  _now() { try { return Date.now(); } catch (e) { return 0; } }

  destroy() {
    try {
      this.stopRoam();
      this.clear();
      if (this._group && this.engine && this.engine.scene) this.engine.scene.remove(this._group);
      // Remove only the verbs we added — leave WorldSystem's terrain ops intact.
      if (typeof window !== 'undefined' && window.worldAPI && this._verbs) {
        for (const k of Object.keys(this._verbs)) {
          if (window.worldAPI[k] === this._verbs[k]) delete window.worldAPI[k];
        }
      }
    } catch (err) { /* never throw on teardown */ }
    this._api = null;
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Measure an object's bounding box and return a normalize transform (pure — it
 * mutates nothing). Applied later via applyNormalize, it recenters the object on
 * X/Z, sits its base at y=0, and scales it to ~1 unit in its largest dimension —
 * so a `scale` multiplier means a predictable world size regardless of how the
 * source asset was authored. Returns { center:[x,y,z], scale:n }.
 */
function measureNormalize(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return { center: [0, 0, 0], scale: 1 };
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // y uses box.min so the base (not the center) lands on the ground.
  return { center: [center.x, box.min.y, center.z], scale: 1 / maxDim };
}

/** Offset the inner object to the normalize origin; scale the wrapper group. */
function applyNormalize(group, inner, norm) {
  if (!norm) return;
  inner.position.set(-norm.center[0], -norm.center[1], -norm.center[2]);
  group.scale.setScalar(norm.scale);
}

function num(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function parseColor(c) {
  if (c === undefined || c === null) return 0xC2A36B; // sandstone default
  try { return new THREE.Color(c).getHex(); } catch (e) { return 0xC2A36B; }
}
