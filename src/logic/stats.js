// Cálculos financieros puros. Reglas para NO contar doble:
//  - expense       → suma al gasto
//  - refund        → RESTA al gasto (de su categoría)
//  - income        → suma al ingreso
//  - transfer / card_payment → NO cuentan como gasto ni ingreso (solo mueven dinero entre cuentas)
import { ym, addMonths, startOfMonth, ymd, round2, daysInMonth, norm } from './util.js';

export const spendOf = t => t.type === 'expense' ? +t.amount_mxn : t.type === 'refund' ? -t.amount_mxn : 0;
export const incomeOf = t => t.type === 'income' ? +t.amount_mxn : 0;
export const isCounted = t => t.type === 'expense' || t.type === 'refund' || t.type === 'income';

export const live = t => !t.deleted_at;
export const inRange = (t, from, to) => { const d = new Date(t.occurred_at); return d >= from && d < to; };

export function filterTx(txs, f = {}) {
  const q = f.q ? norm(f.q) : '';
  return txs.filter(t => {
    if (t.deleted_at) return false;
    if (f.walletIds && !f.walletIds.includes(t.wallet_id)) return false;
    if (f.from && new Date(t.occurred_at) < f.from) return false;
    if (f.to && new Date(t.occurred_at) >= f.to) return false;
    if (f.types && f.types.length && !f.types.includes(t.type)) return false;
    if (f.categoryIds && f.categoryIds.length && !f.categoryIds.includes(t.category_id)) return false;
    if (f.accountIds && f.accountIds.length && !f.accountIds.includes(t.account_id) && !f.accountIds.includes(t.to_account_id)) return false;
    if (f.currency && t.currency !== f.currency) return false;
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
    if (f.minAmount != null && +t.amount_mxn < f.minAmount) return false;
    if (q) {
      const hay = norm([t.description, t.note, (t.tags || []).join(' '), f.catName?.(t.category_id), String(t.amount)].join(' '));
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  });
}

export function totals(txs) {
  let spend = 0, income = 0;
  for (const t of txs) { spend += spendOf(t); income += incomeOf(t); }
  return { spend: round2(spend), income: round2(income), net: round2(income - spend) };
}

// Gasto por categoría (padre si roll=true). Devuelve [{id, total, count}] ordenado desc
export function byCategory(txs, parentOf = null) {
  const m = new Map();
  for (const t of txs) {
    const s = spendOf(t); if (!s) continue;
    let id = t.category_id || '__none';
    if (parentOf) id = parentOf(id) || id;
    const r = m.get(id) || { id, total: 0, count: 0 };
    r.total += s; r.count += t.type === 'expense' ? 1 : 0; m.set(id, r);
  }
  return [...m.values()].map(r => ({ ...r, total: round2(r.total) })).filter(r => r.total !== 0).sort((a, b) => b.total - a.total);
}

export function groupSum(txs, keyFn, valFn = spendOf) {
  const m = new Map();
  for (const t of txs) { const v = valFn(t); if (!v) continue; const k = keyFn(t); m.set(k, (m.get(k) || 0) + v); }
  return [...m.entries()].map(([key, total]) => ({ key, total: round2(total) })).sort((a, b) => b.total - a.total);
}

// Serie mensual: últimos n meses terminando en `end` (incluido)
export function monthlySeries(txs, n = 6, end = new Date()) {
  const start = addMonths(startOfMonth(end), -(n - 1));
  const keys = []; for (let i = 0; i < n; i++) keys.push(ym(addMonths(start, i)));
  const sp = Object.fromEntries(keys.map(k => [k, 0])), inc = Object.fromEntries(keys.map(k => [k, 0]));
  for (const t of txs) {
    const k = ym(new Date(t.occurred_at));
    if (!(k in sp)) continue;
    sp[k] += spendOf(t); inc[k] += incomeOf(t);
  }
  return keys.map(k => ({ key: k, date: new Date(k + '-01T12:00:00'), spend: round2(sp[k]), income: round2(inc[k]) }));
}

export function dailySeries(txs, from, to) {
  const out = []; const m = new Map();
  for (const t of txs) { const k = ymd(new Date(t.occurred_at)); m.set(k, (m.get(k) || 0) + spendOf(t)); }
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) { const k = ymd(d); out.push({ key: k, total: round2(m.get(k) || 0) }); }
  return out;
}

export function weekdaySeries(txs) {
  const arr = Array(7).fill(0);
  for (const t of txs) arr[new Date(t.occurred_at).getDay()] += spendOf(t);
  return arr.map(round2);
}

// Promedio mensual sobre meses COMPLETOS anteriores al actual (ignora meses sin datos al inicio del historial)
export function monthlyAverage(txs, months = 6, ref = new Date()) {
  const s = monthlySeries(txs, months, addMonths(startOfMonth(ref), -1));
  const firstIdx = s.findIndex(x => x.spend !== 0);
  const used = firstIdx === -1 ? [] : s.slice(firstIdx);
  if (!used.length) return { avg: 0, months: 0 };
  return { avg: Math.round(used.reduce((a, b) => a + b.spend, 0) / used.length), months: used.length };
}

export function pctChange(cur, prev) {
  if (!prev) return cur ? null : 0;
  return round2(((cur - prev) / Math.abs(prev)) * 100);
}

// Proyección de cierre de mes (ritmo diario)
export function monthProjection(spentSoFar, ref = new Date()) {
  const day = ref.getDate(), dim = daysInMonth(ref);
  return round2((spentSoFar / day) * dim);
}

// Saldo por cuenta (solo de los movimientos visibles para mí)
export function accountBalances(txs) {
  const b = new Map();
  const add = (id, v) => id && b.set(id, (b.get(id) || 0) + v);
  for (const t of txs) {
    if (t.deleted_at) continue;
    const v = +t.amount_mxn;
    if (t.type === 'expense') add(t.account_id, -v);
    else if (t.type === 'income' || t.type === 'refund') add(t.account_id, v);
    else { add(t.account_id, -v); add(t.to_account_id, v); }
  }
  return b;
}

// Presupuesto: gasto del mes contra lo asignado
export function budgetStatus(budget, monthTxs) {
  const spent = round2(monthTxs.filter(t => !budget.category_id || t.category_id === budget.category_id || t._parent === budget.category_id)
    .reduce((a, t) => a + spendOf(t), 0));
  const amount = +budget.amount;
  return { spent, amount, left: round2(amount - spent), pct: amount ? Math.round((spent / amount) * 100) : 0 };
}

// Gasto en moneda extranjera: guardamos original + tipo de cambio + MXN congelado
export function toMxn(amount, rate) { return round2(Number(amount) * Number(rate || 1)); }
