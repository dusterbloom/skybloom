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

  /** Synchronous read from the mirror (call init() once first). */
  get(name) { return this._mem.get(name) || null; }

  has(name) { return this._mem.has(name); }

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
    const slug = String(base || 'thing').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'thing';
    if (!this._mem.has(slug)) return slug;
    let n = 2;
    while (this._mem.has(`${slug}-${n}`)) n++;
    return `${slug}-${n}`;
  }
}
