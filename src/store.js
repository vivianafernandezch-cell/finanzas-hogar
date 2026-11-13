// Estado central de la app: memoria + IndexedDB + sincronización.
import { openDb, TABLES, getAll, putRows, getOutbox, getMeta, setMeta, wipe } from './db.js';
import { pushAll, pullAll, isNetworkError } from './sync.js';
import { cloudConfigured, remote } from './cloud.js';
import { uuid, nowIso, round2, debounce, ymd } from './logic/util.js';
import { DEFAULT_CATEGORIES } from './logic/seed.js';
import { nextDate, dueOccurrences } from './logic/recurring.js';

const listeners = new Set();
export const S = {
  ready: false, mode: 'local', user: null, people: {}, db: null,
  wallets: new Map(), categories: new Map(), accounts: new Map(), import_batches: new Map(),
  recurring: new Map(), transactions: new Map(), budgets: new Map(),
  sync: { pending: 0, failed: 0, online: navigator.onLine, busy: false, last: null, error: null },
  version: 0,
};
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { S.version++; listeners.forEach(f => f(S.version)); };

// ---------- Preferencias del dispositivo ----------
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('fh:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fh:' + k, JSON.stringify(v)); } catch { /* modo privado */ } },
};

// ---------- Arranque ----------
export async function init({ mode, user }) {
  S.mode = mode; S.user = user;
  S.db = await openDb('fh-' + user.id);
  for (const t of TABLES) {
    const rows = await getAll(S.db, t);
    S[t] = new Map(rows.map(r => [r.id, r]));
  }
  S.people = (await getMeta(S.db, 'people')) || { [user.id]: { id: user.id, display_name: user.name || 'Yo' } };
  if (mode === 'local') await ensureLocalBootstrap();
  await refreshPending();
  S.ready = true; emit();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if (mode === 'cloud') { syncNow(); startSyncLoop(); }
  await autoConfirmRecurring();
}

async function ensureLocalBootstrap() {
  const u = S.user.id;
  if (![...S.wallets.values()].some(w => w.kind === 'personal')) {
    const pw = { id: uuid(), kind: 'personal', owner_id: u, name: 'Mis gastos', created_at: nowIso(), updated_at: nowIso() };
    const hw = { id: uuid(), kind: 'household', owner_id: u, name: 'Hogar', invite_code: 'LOCAL', created_at: nowIso(), updated_at: nowIso() };
    await putRows(S.db, 'wallets', [pw, hw], { dirty: false });
    S.wallets.set(pw.id, pw); S.wallets.set(hw.id, hw);
    await seedCategories(pw.id); await seedCategories(hw.id);
    const cash = { id: uuid(), owner_id: u, name: 'Efectivo', type: 'cash', icon: '💵', currency: 'MXN', sort: 0, hidden: false, created_at: nowIso(), updated_at: nowIso() };
    await upsert('accounts', [cash], { silent: true });
  }
}

async function seedCategories(walletId) {
  const rows = DEFAULT_CATEGORIES.map(([name, icon, color, kind], i) => ({
    id: uuid(), wallet_id: walletId, parent_id: null, name, icon, color, kind: kind || 'expense', sort: i,
    favorite: false, hidden: false, merged_into: null, created_at: nowIso(), updated_at: nowIso(),
  }));
  await upsert('categories', rows, { silent: true });
}

// ---------- Escritura genérica ----------
export async function upsert(table, rows, { silent = false } = {}) {
  if (!rows.length) return;
  const ts = nowIso();
  const full = rows.map(r => ({ ...(S[table].get(r.id) || {}), ...r, updated_at: ts }));
  await putRows(S.db, table, full, { dirty: S.mode === 'cloud' });
  for (const r of full) S[table].set(r.id, r);
  if (!silent) emit();
  await refreshPending();
  scheduleSync();
}

// ---------- Carteras ----------
export const personalWallet = () => [...S.wallets.values()].find(w => w.kind === 'personal' && w.owner_id === S.user.id && !w.deleted_at);
export const householdWallet = () => [...S.wallets.values()].find(w => w.kind === 'household' && !w.deleted_at);
export const walletLabel = w => (w?.kind === 'household' ? 'Hogar' : 'Mis gastos');
export const visibleTx = () => [...S.transactions.values()].filter(t => !t.deleted_at && S.wallets.has(t.wallet_id));

// ---------- Movimientos ----------
export function newTxDraft(walletId) {
  return {
    id: uuid(), wallet_id: walletId, type: 'expense', amount: 0, currency: 'MXN', fx_rate: 1, amount_mxn: 0,
    category_id: null, account_id: prefs.get('lastAccount:' + walletId, null), to_account_id: null,
    description: '', note: '', tags: [], occurred_at: nowIso(), created_by: S.user.id, paid_by: S.user.id,
    receipt_path: null, recurring_id: null, import_batch_id: null, import_hash: null,
  };
}

export function validateTx(t) {
  const errs = [];
  if (!(+t.amount > 0)) errs.push('Escribe una cantidad mayor a 0');
  if (+t.amount > 99999999) errs.push('Cantidad demasiado grande');
  if (!/^[A-Z]{3}$/.test(t.currency)) errs.push('Moneda no válida');
  if (!(+t.fx_rate > 0)) errs.push('Tipo de cambio no válido');
  if (['expense', 'income', 'refund'].includes(t.type) && !t.category_id) errs.push('Elige una categoría');
  const isBoxDeposit = t.type === 'transfer' && !t.account_id && S.accounts.get(t.to_account_id)?.is_box;
  if (['transfer', 'card_payment'].includes(t.type) && !isBoxDeposit && (!t.account_id || !t.to_account_id)) errs.push('Elige cuenta de origen y destino');
  if (t.account_id && t.to_account_id && t.account_id === t.to_account_id) errs.push('Las cuentas deben ser distintas');
  if (!S.wallets.has(t.wallet_id)) errs.push('Cartera no válida');
  const c = t.category_id && S.categories.get(t.category_id);
  if (c && c.wallet_id !== t.wallet_id) errs.push('La categoría no es de esta cartera');
  if (isNaN(new Date(t.occurred_at))) errs.push('Fecha no válida');
  return errs;
}

export async function saveTx(t) {
  const row = { ...t, amount: round2(t.amount), fx_rate: +t.fx_rate || 1 };
  row.amount_mxn = round2(row.amount * row.fx_rate);
  if (['transfer', 'card_payment'].includes(row.type)) row.category_id = null; else row.to_account_id = null;
  if (!S.transactions.has(row.id)) row.created_at = nowIso();
  const errs = validateTx(row);
  if (errs.length) throw new Error(errs[0]);
  await upsert('transactions', [row]);
  prefs.set('lastWallet', row.wallet_id);
  if (row.account_id) prefs.set('lastAccount:' + row.wallet_id, row.account_id);
  return row;
}
export const deleteTx = id => upsert('transactions', [{ id, deleted_at: nowIso() }]);
export const restoreTx = id => upsert('transactions', [{ id, deleted_at: null }]);
export function duplicateTx(t) {
  return { ...t, id: uuid(), occurred_at: nowIso(), created_by: S.user.id, created_at: undefined, receipt_path: null, _receipt_local: null, import_batch_id: null, import_hash: null };
}

// ---------- Categorías ----------
export const categoriesOf = (walletId, { includeHidden = false, kind } = {}) =>
  [...S.categories.values()]
    .filter(c => c.wallet_id === walletId && !c.deleted_at && !c.merged_into && (includeHidden || !c.hidden) && (!kind || c.kind === kind))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

export function saveCategory(c) {
  const row = { favorite: false, hidden: false, parent_id: null, kind: 'expense', merged_into: null, ...c };
  if (!row.id) { row.id = uuid(); row.created_at = nowIso(); row.sort = row.sort ?? 999; }
  if (!row.name?.trim()) throw new Error('Ponle nombre');
  return upsert('categories', [row]);
}
export async function reorderCategories(ids) {
  await upsert('categories', ids.map((id, i) => ({ id, sort: i })));
}
// Fusionar: los movimientos de "from" pasan a "into"; "from" queda oculta (no se borra nada)
export async function mergeCategory(fromId, intoId) {
  if (fromId === intoId) return;
  const from = S.categories.get(fromId), into = S.categories.get(intoId);
  if (!from || !into || from.wallet_id !== into.wallet_id) throw new Error('Solo se fusionan categorías de la misma cartera');
  const moved = [...S.transactions.values()].filter(t => t.category_id === fromId).map(t => ({ id: t.id, category_id: intoId }));
  const subs = [...S.categories.values()].filter(c => c.parent_id === fromId).map(c => ({ id: c.id, parent_id: intoId }));
  const buds = [...S.budgets.values()].filter(b => b.category_id === fromId && !b.deleted_at).map(b => ({ id: b.id, deleted_at: nowIso() }));
  const recs = [...S.recurring.values()].filter(r => r.category_id === fromId).map(r => ({ id: r.id, category_id: intoId }));
  await upsert('transactions', moved, { silent: true });
  await upsert('categories', subs, { silent: true });
  await upsert('budgets', buds, { silent: true });
  await upsert('recurring', recs, { silent: true });
  await upsert('categories', [{ id: fromId, merged_into: intoId, hidden: true }]);
  return moved.length;
}

// Uso reciente para ordenar el teclado de categorías (frecuencia en 120 días + recencia)
export function categoryRanking(walletId, kind = 'expense') {
  const since = Date.now() - 120 * 864e5; const score = new Map();
  for (const t of S.transactions.values()) {
    if (t.wallet_id !== walletId || t.deleted_at || !t.category_id) continue;
    const ts = new Date(t.occurred_at).getTime(); if (ts < since) continue;
    score.set(t.category_id, (score.get(t.category_id) || 0) + 1 + (ts - since) / (120 * 864e5));
  }
  const cats = categoriesOf(walletId, { kind }).filter(c => !c.parent_id);
  return cats.map((c, i) => ({ c, s: (c.favorite ? 1e6 : 0) + (score.get(c.id) || 0) * 10 - i * 0.001 }))
    .sort((a, b) => b.s - a.s).map(x => x.c);
}

// ---------- Cuentas ----------
export const myAccounts = ({ includeHidden = false } = {}) =>
  [...S.accounts.values()].filter(a => a.owner_id === S.user.id && !a.deleted_at && (includeHidden || !a.hidden)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
export function saveAccount(a) {
  const row = { type: 'other', icon: '🪙', currency: 'MXN', hidden: false, sort: 99, ...a, owner_id: a.owner_id || S.user.id };
  if (!row.id) { row.id = uuid(); row.created_at = nowIso(); }
  if (!row.name?.trim()) throw new Error('Ponle nombre a la cuenta');
  return upsert('accounts', [row]);
}

// ---------- Presupuestos ----------
export const budgetsOf = walletId => [...S.budgets.values()].filter(b => b.wallet_id === walletId && !b.deleted_at);
export function saveBudget(b) {
  const row = { ...b }; if (!row.id) { row.id = uuid(); row.created_at = nowIso(); }
  if (!(+row.amount > 0)) throw new Error('Monto no válido');
  return upsert('budgets', [row]);
}
export const deleteBudget = id => upsert('budgets', [{ id, deleted_at: nowIso() }]);

// ---------- Recurrentes ----------
export const recurringOf = walletId => [...S.recurring.values()].filter(r => !r.deleted_at && (!walletId || r.wallet_id === walletId));
export function saveRecurring(r) {
  const row = { active: true, auto_confirm: false, currency: 'MXN', type: 'expense', ...r };
  if (!row.id) { row.id = uuid(); row.created_at = nowIso(); row.created_by = S.user.id; }
  if (!(+row.amount > 0)) throw new Error('Monto no válido');
  if (!row.next_date) throw new Error('Elige la fecha del próximo pago');
  return upsert('recurring', [row]);
}
export const deleteRecurring = id => upsert('recurring', [{ id, deleted_at: nowIso(), active: false }]);

// Confirmar un pago programado → crea el movimiento real y avanza la fecha
export async function confirmRecurring(rule, { date, amount, fx_rate = 1 } = {}) {
  const d = date || rule.next_date;
  const tx = {
    ...newTxDraft(rule.wallet_id), type: rule.type, amount: +(amount ?? rule.amount), currency: rule.currency,
    fx_rate, category_id: rule.category_id, account_id: rule.account_id, description: rule.description,
    occurred_at: new Date(d + 'T12:00:00').toISOString(), recurring_id: rule.id,
    id: deterministicId(rule.id, d),            // mismo pago confirmado en 2 teléfonos = 1 solo movimiento
  };
  await saveTx(tx);
  await upsert('recurring', [{ id: rule.id, next_date: nextDate(d, rule.frequency) }]);
  return tx;
}
export const skipRecurring = rule => upsert('recurring', [{ id: rule.id, next_date: nextDate(rule.next_date, rule.frequency) }]);

async function autoConfirmRecurring() {
  for (const r of recurringOf()) {
    if (!r.auto_confirm || !r.active || r.currency !== 'MXN') continue;
    for (const d of dueOccurrences(r)) { try { await confirmRecurring(S.recurring.get(r.id), { date: d }); } catch (e) { console.warn(e); break; } }
  }
}
function deterministicId(seed, date) {
  // UUID v4 con forma válida derivado de (regla, fecha)
  let h1 = 0x811c9dc5, h2 = 0x1b873593; const s = seed + '|' + date;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519); }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2));
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-a${a.slice(17, 20)}-${a.slice(20, 32)}`;
}

// ---------- Importaciones ----------
export async function importTransactions(txRows, { filename, newCategories = [] }) {
  const batch = { id: uuid(), created_by: S.user.id, filename, row_count: txRows.length, created_at: nowIso(), reverted_at: null };
  await upsert('import_batches', [batch], { silent: true });
  if (newCategories.length) await upsert('categories', newCategories, { silent: true });
  const rows = txRows.map(({ _raw_category, ...t }) => ({
    ...t, id: uuid(), created_by: S.user.id, paid_by: S.user.id, note: t.note || '', to_account_id: null,
    receipt_path: null, recurring_id: null, import_batch_id: batch.id, created_at: nowIso(),
  }));
  for (let i = 0; i < rows.length; i += 1000) await upsert('transactions', rows.slice(i, i + 1000), { silent: true });
  emit();
  return batch;
}
export async function revertImport(batchId) {
  const del = [...S.transactions.values()].filter(t => t.import_batch_id === batchId && !t.deleted_at).map(t => ({ id: t.id, deleted_at: nowIso() }));
  for (let i = 0; i < del.length; i += 1000) await upsert('transactions', del.slice(i, i + 1000), { silent: true });
  await upsert('import_batches', [{ id: batchId, reverted_at: nowIso() }]);
  return del.length;
}
export const existingHashes = () => {
  const s = new Set();
  for (const t of S.transactions.values()) if (!t.deleted_at) s.add(t.import_hash || hashOf(t));
  return s;
};
import { txHash } from './logic/importer.js';
const hashOf = t => txHash(t);

// ---------- Sincronización ----------
async function refreshPending() {
  if (!S.db) return;
  const box = await getOutbox(S.db);
  S.sync.pending = box.length; S.sync.failed = box.filter(b => b.error).length;
  S.sync.pendingIds = new Set(box.filter(b => b.table === 'transactions').map(b => b.id));
}
export const isPending = id => S.sync.pendingIds?.has(id);

let syncing = null;
export function syncNow() {
  if (S.mode !== 'cloud') return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    S.sync.busy = true; emit();
    try {
      await pushAll(S.db, remote, {
        readRows: async (table, ids) => ids.map(id => S[table].get(id)).filter(Boolean),
        beforePush: async (table, rows) => { if (table === 'transactions') await uploadReceipts(rows); },
      });
      await pullAll(S.db, remote, {
        onRows: (table, rows) => { for (const r of rows) S[table].set(r.id, r); },
        onPeople: async people => { S.people = Object.fromEntries(people.map(p => [p.id, p])); await setMeta(S.db, 'people', S.people); },
        mergeLocal: (table, rows) => rows.map(r => {
          const loc = S[table].get(r.id); if (!loc) return r;
          const keep = {}; for (const k in loc) if (k.startsWith('_')) keep[k] = loc[k];
          return { ...r, ...keep };
        }),
      });
      S.sync.last = new Date(); S.sync.error = null; S.sync.online = true;
      await setMeta(S.db, 'lastSync', S.sync.last.toISOString());
    } catch (e) {
      S.sync.error = isNetworkError(e) ? 'Sin conexión: tus movimientos están guardados en el teléfono.' : (e.message || String(e));
      if (isNetworkError(e)) S.sync.online = false;
      console.warn('sync', e);
    } finally {
      await refreshPending(); S.sync.busy = false; syncing = null; emit();
    }
  })();
  return syncing;
}
const scheduleSync = debounce(() => syncNow(), 800);

async function uploadReceipts(rows) {
  for (const t of rows) {
    if (t._receipt_local && !t.receipt_path) {
      const blob = await (await fetch(t._receipt_local)).blob();
      const path = `${t.wallet_id}/${t.id}.jpg`;
      await remote.uploadReceipt(path, blob);
      t.receipt_path = path;
      S.transactions.set(t.id, t);
      await putRows(S.db, 'transactions', [t], { dirty: false });
    }
  }
}

let loopStarted = false;
function startSyncLoop() {
  if (loopStarted) return; loopStarted = true;
  window.addEventListener('online', () => { S.sync.online = true; syncNow(); });
  window.addEventListener('offline', () => { S.sync.online = false; emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  setInterval(() => { if (!document.hidden) syncNow(); }, 60_000);
}

// ---------- Respaldo completo (JSON) ----------
export function backupJson() {
  const data = { app: 'finanzas-hogar', version: 1, exported_at: nowIso(), user: S.user.id };
  for (const t of TABLES) data[t] = [...S[t].values()].filter(r => t !== 'accounts' || r.owner_id === S.user.id).map(r => {
    const { _receipt_local, ...rest } = r; return rest;
  });
  // Solo lo que es mío o de Hogar (nunca datos personales de otra persona)
  return data;
}
export async function restoreJson(data) {
  if (data?.app !== 'finanzas-hogar') throw new Error('Este archivo no es un respaldo de la app');
  let n = 0;
  for (const t of TABLES) {
    if (t === 'wallets' || t === 'handovers' || !Array.isArray(data[t])) continue;
    const rows = data[t].filter(r => t === 'accounts' || t === 'import_batches' || S.wallets.has(r.wallet_id) || remapWallet(r, data));
    if (S.mode === 'cloud' && t === 'accounts') rows.forEach(r => (r.owner_id = S.user.id));
    if (rows.length) { await upsert(t, rows, { silent: true }); n += rows.length; }
  }
  emit(); return n;
}
function remapWallet(r, data) {
  // Si el respaldo viene de otra instalación, mapear por tipo de cartera
  const src = (data.wallets || []).find(w => w.id === r.wallet_id); if (!src) return false;
  const dst = src.kind === 'household' ? householdWallet() : personalWallet(); if (!dst) return false;
  r.wallet_id = dst.id; return true;
}

export async function wipeLocal() { await wipe(S.db); }

// ---------- Datos de ejemplo (solo modo local / pruebas) ----------
export async function loadDemoData() {
  const pw = personalWallet(), hw = householdWallet();
  const andres = 'demo-andres';
  S.people[andres] = { id: andres, display_name: 'Andrés' };
  S.people[S.user.id] = S.people[S.user.id] || { id: S.user.id, display_name: 'Viviana' };
  await setMeta(S.db, 'people', S.people);
  const accs = [
    { id: uuid(), owner_id: S.user.id, name: 'BBVA Débito', type: 'debit', icon: '💳', sort: 1 },
    { id: uuid(), owner_id: S.user.id, name: 'Amex', type: 'credit', icon: '💳', sort: 2 },
  ].map(a => ({ currency: 'MXN', hidden: false, created_at: nowIso(), ...a }));
  await upsert('accounts', accs, { silent: true });
  const cash = myAccounts().find(a => a.type === 'cash');
  const cat = (w, name) => categoriesOf(w.id).find(c => c.name === name).id;
  const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
  const rows = [];
  const today = new Date();
  for (let back = 0; back < 180; back++) {
    const d = new Date(today); d.setDate(d.getDate() - back); d.setHours(rnd(8, 21), rnd(0, 59));
    const push = (w, name, amt, desc, extra = {}) => rows.push({
      ...newTxDraft(w.id), category_id: cat(w, name), amount: amt, amount_mxn: amt, description: desc,
      occurred_at: d.toISOString(), account_id: (extra.acc || accs[0]).id, ...extra,
    });
    if (Math.random() < 0.45) push(pw, 'Alimentos y bebidas', rnd(45, 180), ['Café', 'Comida oficina', 'Snack'][rnd(0, 2)], { acc: cash });
    if (Math.random() < 0.12) push(pw, 'Restaurantes', rnd(350, 1400), ['Sushi', 'Tacos con amigas', 'Cena'][rnd(0, 2)]);
    if (Math.random() < 0.06) push(pw, 'Belleza', rnd(250, 900), ['Uñas', 'Corte de pelo', 'Crema'][rnd(0, 2)], { acc: accs[1] });
    if (Math.random() < 0.05) push(pw, 'Ropa', rnd(400, 1800), 'Ropa');
    if (Math.random() < 0.08) push(pw, 'Transporte', rnd(30, 140), ['Uber', 'Estacionamiento'][rnd(0, 1)], { acc: cash });
    if (Math.random() < 0.05) push(pw, 'Bebé / Hijos', rnd(100, 600), ['Cumpleaños', 'Juguete', 'Útiles'][rnd(0, 2)]);
    if (d.getDay() === 6) push(hw, 'Supermercado', rnd(1400, 2900), 'Súper semanal', { created_by: andres, paid_by: andres });
    if (d.getDay() === 1) push(hw, 'Hogar', 1000, 'Magui semana', { acc: cash });
    if (d.getDate() === 5) push(hw, 'Servicios', rnd(600, 1100), 'Luz CFE', { created_by: andres, paid_by: andres });
    if (d.getDate() === 10) push(hw, 'Suscripciones', 299, 'Netflix');
    if (d.getDate() === 1) rows.push({ ...newTxDraft(pw.id), type: 'income', category_id: categoriesOf(pw.id, { kind: 'income' })[0].id, amount: 25000, amount_mxn: 25000, description: 'Ingreso del mes', occurred_at: d.toISOString(), account_id: accs[0].id });
  }
  // Un viaje en dólares con etiqueta
  for (let i = 0; i < 6; i++) {
    const d = new Date(today); d.setMonth(d.getMonth() - 2); d.setDate(10 + i);
    const usd = rnd(20, 120), rate = 18.4;
    rows.push({ ...newTxDraft(pw.id), category_id: cat(pw, i % 2 ? 'Restaurantes' : 'Viajes'), amount: usd, currency: 'USD', fx_rate: rate, amount_mxn: round2(usd * rate), description: i % 2 ? 'Comida' : 'Metro/Museo', tags: ['Chicago 2026'], occurred_at: d.toISOString(), account_id: accs[1].id });
  }
  const amexPay = { ...newTxDraft(pw.id), type: 'card_payment', category_id: null, amount: 5000, amount_mxn: 5000, account_id: accs[0].id, to_account_id: accs[1].id, description: 'Pago Amex', occurred_at: new Date(today.getFullYear(), today.getMonth(), 2, 10).toISOString() };
  rows.push(amexPay);
  await upsert('transactions', rows, { silent: true });
  await upsert('budgets', [
    { id: uuid(), wallet_id: pw.id, category_id: cat(pw, 'Restaurantes'), amount: 3000 },
    { id: uuid(), wallet_id: pw.id, category_id: cat(pw, 'Belleza'), amount: 1500 },
    { id: uuid(), wallet_id: hw.id, category_id: cat(hw, 'Supermercado'), amount: 9000 },
  ], { silent: true });
  const nd = ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  await upsert('recurring', [{ id: uuid(), wallet_id: hw.id, created_by: S.user.id, type: 'expense', amount: 1000, currency: 'MXN', category_id: cat(hw, 'Hogar'), account_id: cash.id, description: 'Limpieza (Magui)', frequency: 'weekly', next_date: nd, auto_confirm: false, active: true }], { silent: true });
  emit();
  return rows.length;
}


// ================= 💵 Caja chica (Hogar) =================
// Una cuenta de efectivo marcada is_box. Entradas = transferencias (no son gasto).
// Gastos pagados con la caja = gastos normales de Hogar con account_id = caja (sí son gasto).
export const boxAccount = () => [...S.accounts.values()].find(a => a.is_box && !a.deleted_at);
export async function createBox() {
  if (boxAccount()) return boxAccount();
  await saveAccount({ name: 'Caja chica', type: 'cash', icon: '💵', is_box: true, sort: -1 });
  return boxAccount();
}
export function boxMovements() {
  const box = boxAccount(); if (!box) return { balance: 0, items: [] };
  const list = [...S.transactions.values()]
    .filter(t => !t.deleted_at && (t.account_id === box.id || t.to_account_id === box.id))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || (a.created_at || '').localeCompare(b.created_at || ''));
  let bal = 0;
  const items = list.map(t => {
    const delta = t.to_account_id === box.id ? +t.amount_mxn : (t.type === 'refund' ? +t.amount_mxn : -t.amount_mxn);
    bal = round2(bal + delta);
    return { t, delta, balance: bal };
  });
  return { balance: bal, items: items.reverse() };
}
export async function addBoxDeposit({ amount, date, note }) {
  const box = boxAccount(); const hw = householdWallet();
  if (!box || !hw) throw new Error('Primero crea la caja chica');
  const d = date ? new Date(date + 'T12:00:00') : new Date();
  return saveTx({ ...newTxDraft(hw.id), type: 'transfer', account_id: null, to_account_id: box.id, category_id: null,
    amount: +amount, description: note || 'Efectivo para la caja', occurred_at: d.toISOString() });
}

// ================= ✅✅ Entregas con doble palomita (ej. Magui) =================
import { remote as cloudRemote } from './cloud.js';
export const handoverRules = () => [...S.handover_rules.values()].filter(r => !r.deleted_at);
export const handoversList = () => [...S.handovers.values()].filter(h => !h.deleted_at).sort((a, b) => b.period_date.localeCompare(a.period_date));

export async function saveHandoverRule(r) {
  const hw = householdWallet(); if (!hw) throw new Error('Primero crea Hogar');
  const row = { frequency: 'weekly', active: true, wallet_id: hw.id, payee_id: S.user.id, ...r };
  if (!row.id) { row.id = uuid(); row.created_at = nowIso(); row.created_by = S.user.id; }
  if (!row.concept?.trim()) throw new Error('Ponle nombre (ej. Magui)');
  if (!(+row.amount > 0)) throw new Error('Monto no válido');
  if (!row.start_date) throw new Error('Elige la primera semana');
  row.amount = round2(+row.amount);
  await upsert('handover_rules', [row]);
  await refreshHandovers();
}

// Genera semanas pendientes (en el servidor, sin duplicar) y baja los cambios
export async function refreshHandovers() {
  if (S.mode === 'cloud') {
    if (!navigator.onLine) return;
    await syncNow();                                   // sube reglas nuevas primero
    try { await cloudRemote.rpc('ensure_handovers'); } catch (e) { console.warn(e); }
    await syncNow();
  } else {
    const rows = [];
    for (const r of handoverRules().filter(r => r.active)) {
      const step = { weekly: 7, biweekly: 14 }[r.frequency];
      let d = new Date(r.start_date + 'T12:00:00');
      while (ymd(d) <= ymd(new Date())) {
        const pd = ymd(d); const id = deterministicId(r.id, pd);
        if (!S.handovers.has(id)) rows.push({ id, rule_id: r.id, wallet_id: r.wallet_id, concept: r.concept, amount: r.amount, period_date: pd, payee_id: r.payee_id, given_at: null, received_at: null, note: '', created_at: nowIso() });
        if (step) d.setDate(d.getDate() + step); else d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate(), 12);
      }
    }
    if (rows.length) await upsert('handovers', rows);
  }
}

export async function confirmHandover(h, side, done) {
  if (S.mode === 'cloud') {
    if (!navigator.onLine) throw new Error('Necesitas internet para confirmar (así los dos ven lo mismo).');
    await cloudRemote.rpc('confirm_handover', { h: h.id, side, done });
    await syncNow();
  } else {
    const patch = side === 'given' ? { given_at: done ? nowIso() : null, given_by: done ? S.user.id : null } : { received_at: done ? nowIso() : null, received_by: done ? S.user.id : null };
    await upsert('handovers', [{ id: h.id, ...patch }]);
  }
}
export async function editHandover(h, amount, note) {
  if (S.mode === 'cloud') { await cloudRemote.rpc('edit_handover', { h: h.id, new_amount: +amount, new_note: note || '' }); await syncNow(); }
  else { const changed = +amount !== +h.amount; await upsert('handovers', [{ id: h.id, amount: round2(+amount), note: note || '', ...(changed ? { given_at: null, received_at: null } : {}) }]); }
}
export async function addHandover({ concept, amount, date }) {
  const hw = householdWallet();
  if (S.mode === 'cloud') { await cloudRemote.rpc('add_handover', { w: hw.id, p_concept: concept, p_amount: +amount, p_date: date, p_payee: S.user.id }); await syncNow(); }
  else await upsert('handovers', [{ id: uuid(), rule_id: null, wallet_id: hw.id, concept, amount: round2(+amount), period_date: date, payee_id: S.user.id, given_at: null, received_at: null, note: '', created_at: nowIso() }]);
}
export async function deleteHandover(h) {
  if (S.mode === 'cloud') { await cloudRemote.rpc('delete_handover', { h: h.id }); await syncNow(); }
  else await upsert('handovers', [{ id: h.id, deleted_at: nowIso() }]);
}
export const handoverStatus = h => h.given_at && h.received_at ? 'ok' : h.given_at || h.received_at ? 'half' : 'none';
