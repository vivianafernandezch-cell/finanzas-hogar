// IndexedDB mínimo. Una base por usuario → si Andrés abre sesión en el mismo equipo, no ve lo tuyo.
export const TABLES = ['wallets', 'categories', 'accounts', 'import_batches', 'recurring', 'transactions', 'budgets'];
const VERSION = 1;

export function openDb(name) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Base local bloqueada: cierra otras pestañas de la app.'));
  });
}

const tx = (db, stores, mode = 'readonly') => db.transaction(stores, mode);
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort')); });
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getAll = (db, store) => req(tx(db, store).objectStore(store).getAll());
export const getMeta = (db, key) => req(tx(db, 'meta').objectStore('meta').get(key));
export async function setMeta(db, key, val) { const t = tx(db, 'meta', 'readwrite'); t.objectStore('meta').put(val, key); return done(t); }

// Escribe filas y (opcional) las marca como pendientes de subir, en UNA transacción atómica
export async function putRows(db, store, rows, { dirty = true } = {}) {
  const t = tx(db, dirty ? [store, 'outbox'] : [store], 'readwrite');
  const s = t.objectStore(store), o = dirty ? t.objectStore('outbox') : null;
  const ts = Date.now() + Math.random();
  for (const r of rows) { s.put(r); if (o) o.put({ k: store + ':' + r.id, table: store, id: r.id, ts }); }
  return done(t);
}

export const getOutbox = db => getAll(db, 'outbox');
// Borra SOLO si nadie volvió a editar la fila mientras se subía (mismo ts)
export async function clearOutbox(db, entries) {
  const t = tx(db, 'outbox', 'readwrite'); const o = t.objectStore('outbox');
  for (const e of entries) {
    const g = o.get(e.k);
    g.onsuccess = () => { if (g.result && g.result.ts === e.ts) o.delete(e.k); };
  }
  return done(t);
}
export async function markOutboxError(db, entries, error) {
  const t = tx(db, 'outbox', 'readwrite'); const o = t.objectStore('outbox');
  for (const e of entries) o.put({ ...e, error, tries: (e.tries || 0) + 1 });
  return done(t);
}

export async function wipe(db) {
  const stores = [...TABLES, 'outbox', 'meta'];
  const t = tx(db, stores, 'readwrite'); for (const s of stores) t.objectStore(s).clear();
  return done(t);
}
