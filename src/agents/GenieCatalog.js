/**
 * GenieCatalog — the persistent spine of the genie's world-authoring power.
 *
 * Every artifact the genie ever conjures — whether IMPORTED from an online
 * repo (a raw .glb blob) or GENERATED from primitives (a tiny spec) — lands
 * here as a first-class, re-spawnable entry. It survives reloads because it
 * lives in IndexedDB, matching the game's serverless ("no server YOU host")
 * philosophy: the catalogue is a local library that grows forever.
 *
 * An entry:
 *   {
 *     name:      unique slug, e.g. "dragon" | "pyramid-3"
 *     kind:      'gltf' | 'primitive'
 *     source:    where it came from (repo url, 'generated', 'sandbox')
 *     glb:       ArrayBuffer (kind==='gltf') — the original asset bytes
 *     primitive: { shape, color, ... } (kind==='primitive')
 *     normalize: { center:[x,y,z], scale:n } applied at import so re-spawns
 *                land at a sane size/origin without re-measuring
 *     createdAt: ms epoch (passed in — this module never reads the clock)
 *   }
 *
 * This module is pure storage + a thin in-memory mirror; it knows nothing
 * about THREE. GenieSystem turns entries into meshes.
 */

const DB_NAME = 'skybloom-genie';
const STORE = 'catalog';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable — genie catalogue cannot persist.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open genie DB'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = fn(store); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error || new Error('genie tx failed'));
    t.onabort = () => reject(t.error || new Error('genie tx aborted'));
  });
}

export class GenieCatalog {
  constructor() {
    this._db = null;
    this._mem = new Map(); // name -> entry (mirrors the store; hot for list())
    this._ready = null;
  }

  /** Open the DB and hydrate the in-memory mirror. Idempotent. */
  async init() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      this._db = await openDB();
      const all = await tx(this._db, 'readonly', (s) => {
        return new Promise((res, rej) => {
          const r = s.getAll();
          r.onsuccess = () => res(r.result || []);
          r.onerror = () => rej(r.error);
        });
      });
      for (const e of all) if (e && e.name) this._mem.set(e.name, e);
      return this;
    })();
    return this._ready;
  }

  /**
   * Persist (or overwrite) an entry. Caller supplies createdAt so this module
   * stays clock-free (deterministic, replay-safe). Returns the stored entry.
   */
  async save(entry) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) {
      throw new Error('GenieCatalog.save: entry.name is required.');
    }
    const stored = { createdAt: 0, source: 'generated', ...entry };
    await this.init();
    await tx(this._db, 'readwrite', (s) => s.put(stored));
    this._mem.set(stored.name, stored);
    return stored;
  }

  /**
   * Synchronous EXACT read from the mirror (call init() once first). Kept
   * strict on purpose: internal callers that already hold a name they just
   * stored (e.g. the entry.name a save()/spawn() call handed back) know it's
   * correct and want a plain, unsurprising Map lookup — no guessing. Callers
   * fed a name from OUTSIDE (model output, voice transcript, UI text field)
   * want `resolve()` instead, which tolerates case and slug drift.
   */
  get(name) { return this._mem.get(name) || null; }

  has(name) { return this._mem.has(name); }

  /**
   * Resolve a name the way a human or model would type it — not the way
   * uniqueName() stored it — to the catalogue entry they meant. `get()` stays
   * a strict Map lookup on the stored slug; this exists because callers on
   * the OUTSIDE of the catalogue (a model's "vehicle":"Flamingo" op, a typed
   * catalog name) never see the slug uniqueName() actually wrote, so an exact
   * lookup silently misses ("Flamingo" vs the stored "flamingo").
   *
   * Matching, in order (mirrors GenieSystem._resolveAsset's exact > startsWith
   * > includes so the two name-resolution paths in this codebase behave the
   * same way):
   *   1. "Family" match — the query slugifies to the same base uniqueName()
   *      would use, so it matches the base entry AND any of its "-2", "-3"…
   *      collision siblings (but NOT an unrelated entry that merely shares a
   *      text prefix, e.g. "flamingo-jr" saved under an explicit `as` name —
   *      that only matches on '-<digits>', which uniqueName never produces
   *      for anything but true collisions of the same base).
   *   2. Slug startsWith the query.
   *   3. Slug includes the query.
   * Whichever tier fires, looser tiers are never consulted — an exact/family
   * hit always wins over a fuzzier one, so a same-prefix but different object
   * can't steal the match out from under it.
   *
   * When a tier produces more than one candidate (repeated imports of the
   * same name leave "flamingo", "flamingo-2", "flamingo-3" all matching), the
   * newest one (highest createdAt) wins — "summon a flamingo, then ride it"
   * should ride the one just summoned, not the stalest same-named entry.
   *
   * Returns the entry, or null for no match / empty / null / undefined input.
   */
  resolve(name) {
    if (!name) return null;
    const slug = GenieCatalog.slugify(name);
    if (!slug) return null;

    const entries = Array.from(this._mem.values());
    if (!entries.length) return null;

    const familyRe = new RegExp(`^${slug}(-\\d+)?$`);
    let candidates = entries.filter((e) => familyRe.test(e.name));
    if (!candidates.length) candidates = entries.filter((e) => e.name.startsWith(slug));
    if (!candidates.length) candidates = entries.filter((e) => e.name.includes(slug));
    if (!candidates.length) return null;

    return candidates.reduce((best, e) => ((e.createdAt || 0) > (best.createdAt || 0) ? e : best));
  }

  /** Lightweight listing for UI/agent — no heavy glb bytes. */
  list() {
    return Array.from(this._mem.values()).map((e) => ({
      name: e.name,
      kind: e.kind,
      source: e.source,
      createdAt: e.createdAt,
    }));
  }

  async delete(name) {
    await this.init();
    await tx(this._db, 'readwrite', (s) => s.delete(name));
    this._mem.delete(name);
  }

  /**
   * Pick a unique name from a desired base, e.g. "pyramid" -> "pyramid",
   * then "pyramid-2", "pyramid-3"… so repeated conjurings never collide.
   */
  uniqueName(base) {
    const slug = GenieCatalog.slugify(base) || 'thing';
    if (!this._mem.has(slug)) return slug;
    let n = 2;
    while (this._mem.has(`${slug}-${n}`)) n++;
    return `${slug}-${n}`;
  }

  /**
   * The slug rule shared by uniqueName() (writing entries) and resolve()
   * (reading them back by a name typed elsewhere) — factored out so the two
   * can never drift apart. Unlike uniqueName(), this has NO 'thing' fallback:
   * an empty/symbols-only query should resolve to nothing, not accidentally
   * match a real entry that happens to be named "thing".
   */
  static slugify(base) {
    return String(base || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
}
