// Motor de sincronización "local primero":
//  1. Todo se guarda PRIMERO en el teléfono (IndexedDB) + una bandeja de salida (outbox).
//  2. Al haber internet: PUSH (subir outbox con upsert por id → reintentar nunca duplica)
//     y luego PULL (bajar lo que cambió en el servidor desde el último cursor).
//  3. Conflictos: gana la última edición. Si una fila local está pendiente de subir, NO se pisa con la del servidor.
import { TABLES, getOutbox, clearOutbox, markOutboxError, putRows, getMeta, setMeta } from './db.js';

const PUSH_ORDER = ['accounts', 'categories', 'import_batches', 'recurring', 'transactions', 'budgets'];
const CHUNK = 500;
const OVERLAP_MS = 5 * 60 * 1000;   // relee 5 min hacia atrás por si hubo escrituras concurrentes

export const cleanForServer = row => {
  const o = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('_')) o[k] = v;
  return o;
};

/**
 * remote: { upsert(table, rows), pull(table, sinceIso) → rows[], fetchWallets() → {wallets, people} }
 * hooks:  { onRows(table, rows) } para refrescar la memoria
 */
export async function pushAll(db, remote, hooks = {}) {
  const box = await getOutbox(db);
  if (!box.length) return { pushed: 0, failed: 0 };
  let pushed = 0, failed = 0;
  for (const table of PUSH_ORDER) {
    const entries = box.filter(e => e.table === table);
    if (!entries.length) continue;
    const rows = await hooks.readRows(table, entries.map(e => e.id));
    const byId = new Map(rows.map(r => [r.id, r]));
    for (let i = 0; i < entries.length; i += CHUNK) {
      const part = entries.slice(i, i + CHUNK).filter(e => byId.has(e.id));
      if (!part.length) continue;
      try {
        if (hooks.beforePush) await hooks.beforePush(table, part.map(e => byId.get(e.id)));
        await remote.upsert(table, part.map(e => cleanForServer(byId.get(e.id))));
        await clearOutbox(db, part);
        pushed += part.length;
      } catch (err) {
        if (isNetworkError(err)) throw err;                // sin red: se reintenta después, nada se pierde
        // Error de datos: probar fila por fila para aislar la culpable y no bloquear las demás
        for (const e of part) {
          try { await remote.upsert(table, [cleanForServer(byId.get(e.id))]); await clearOutbox(db, [e]); pushed++; }
          catch (err2) {
            if (isNetworkError(err2)) throw err2;
            failed++; await markOutboxError(db, [e], String(err2.message || err2));
          }
        }
      }
    }
  }
  return { pushed, failed };
}

export async function pullAll(db, remote, hooks = {}) {
  const box = await getOutbox(db);
  const dirty = new Set(box.map(e => e.k));
  let pulled = 0;
  if (remote.fetchWallets) {
    const { wallets, people } = await remote.fetchWallets();
    await putRows(db, 'wallets', wallets, { dirty: false });
    hooks.onRows?.('wallets', wallets); hooks.onPeople?.(people);
  }
  for (const table of TABLES.filter(t => t !== 'wallets')) {
    const cursorKey = 'cursor:' + table;
    const cursor = (await getMeta(db, cursorKey)) || '1970-01-01T00:00:00Z';
    const since = new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString();
    const rows = await remote.pull(table, since);
    if (!rows.length) continue;
    const fresh = rows.filter(r => !dirty.has(table + ':' + r.id));
    if (fresh.length) {
      const merged = hooks.mergeLocal ? hooks.mergeLocal(table, fresh) : fresh;
      await putRows(db, table, merged, { dirty: false });
      hooks.onRows?.(table, merged);
    }
    const maxTs = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor);
    await setMeta(db, cursorKey, maxTs);
    pulled += fresh.length;
  }
  return { pulled };
}

export function isNetworkError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return err?.name === 'TypeError' || /failed to fetch|network|load failed|offline|timeout|fetch/.test(m) || err?.status === 0;
}
