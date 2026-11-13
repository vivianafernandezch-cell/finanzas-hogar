// Pruebas automáticas — abrir tests/index.html en el navegador (con el servidor local).
import { parseAmount, money, periodRange, previousRange, comparableRange, round2 } from '../src/logic/util.js';
import { totals, byCategory, monthlySeries, accountBalances, budgetStatus, filterTx, monthlyAverage } from '../src/logic/stats.js';
import { autoMap, parseDate, parseType, buildRows, suggestCategory, guessDayFirst, txHash } from '../src/logic/importer.js';
import { nextDate, dueOccurrences } from '../src/logic/recurring.js';
import { computeInsights } from '../src/logic/insights.js';
import { openDb, putRows, getOutbox, getAll } from '../src/db.js';
import { pushAll, pullAll, cleanForServer } from '../src/sync.js';
import { evalExpr } from '../src/ui/add.js';

const results = [];
let current = '';
const group = n => (current = n);
const ok = (cond, name, extra = '') => results.push({ g: current, name, pass: !!cond, extra });
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `esperado ${JSON.stringify(b)} · obtenido ${JSON.stringify(a)}`);

const tx = (o) => ({ id: crypto.randomUUID(), wallet_id: 'W', type: 'expense', amount: 100, currency: 'MXN', fx_rate: 1, amount_mxn: 100, category_id: 'c1', account_id: 'a1', to_account_id: null, description: '', tags: [], occurred_at: new Date().toISOString(), ...o });

// ---------- Montos ----------
group('Montos y formato');
eq(parseAmount('1,234.50'), 1234.5, 'parse 1,234.50');
eq(parseAmount('1.234,50'), 1234.5, 'parse 1.234,50 (europeo)');
eq(parseAmount('-2,450.00'), -2450, 'parse negativo con miles');
eq(parseAmount('$ 20'), 20, 'parse $ 20');
eq(parseAmount('12,5'), 12.5, 'parse 12,5');
ok(isNaN(parseAmount('abc')), 'texto no es número');
eq(evalExpr('120+35.5'), 155.5, 'teclado suma 120+35.5');
eq(evalExpr('100-20'), 80, 'teclado resta');
ok(money(1500).includes('1,500'), 'formato MXN con miles', money(1500));
eq(round2(0.1 + 0.2), 0.3, 'redondeo 0.1+0.2');

// ---------- No contar doble ----------
group('Estadísticas sin doble conteo');
const base = [
  tx({ amount_mxn: 500 }), tx({ amount_mxn: 300, category_id: 'c2' }),
  tx({ type: 'income', amount_mxn: 10000, category_id: 'inc' }),
  tx({ type: 'transfer', amount_mxn: 2000, category_id: null, account_id: 'a1', to_account_id: 'a2' }),
  tx({ type: 'card_payment', amount_mxn: 5000, category_id: null, account_id: 'a1', to_account_id: 'card' }),
  tx({ type: 'refund', amount_mxn: 100, category_id: 'c1' }),
  tx({ amount_mxn: 999, deleted_at: new Date().toISOString() }),
];
const live = filterTx(base, {});
const t = totals(live);
eq(t.spend, 700, 'gasto = 500+300-100 (reembolso resta; transferencia y pago de tarjeta no cuentan; borrado no cuenta)');
eq(t.income, 10000, 'ingreso');
eq(t.net, 9300, 'flujo neto');
eq(byCategory(live).map(c => [c.id, c.total]), [['c1', 400], ['c2', 300]], 'por categoría con reembolso');
const bal = accountBalances(live);
eq(bal.get('card'), 5000, 'pago de tarjeta abona a la tarjeta');
eq(bal.get('a2'), 2000, 'transferencia llega a destino');

group('Periodos');
const ref = new Date(2026, 10, 12, 15);
const r = periodRange('month', null, ref);
eq([r.from.getMonth(), r.to.getMonth()], [10, 11], 'este mes = noviembre');
const pr = previousRange(r);
eq([pr.from.getMonth(), pr.to.getMonth()], [9, 10], 'mes anterior = octubre');
const r3 = periodRange('3m', null, ref);
eq([r3.from.getMonth(), previousRange(r3).from.getMonth()], [8, 5], '3 meses vs 3 previos');
const cr = comparableRange(r, ref);
ok(cr.partial && cr.to.getMonth() === 9 && cr.to.getDate() === 12, 'comparación justa: 1–12 oct vs 1–12 nov', cr.to.toString());
const ser = monthlySeries([tx({ occurred_at: new Date(2026, 9, 3).toISOString(), amount_mxn: 50 })], 6, ref);
eq(ser.map(s => s.spend), [0, 0, 0, 0, 50, 0], 'serie 6 meses');
eq(monthlyAverage([tx({ occurred_at: new Date(2026, 8, 3).toISOString(), amount_mxn: 300 }), tx({ occurred_at: new Date(2026, 9, 3).toISOString(), amount_mxn: 100 })], 6, ref).avg, 200, 'promedio ignora meses previos al inicio del historial');

group('Presupuestos');
eq(budgetStatus({ category_id: 'c1', amount: 1000 }, live), { spent: 400, amount: 1000, left: 600, pct: 40 }, 'presupuesto por categoría');

group('Multidivisa');
const usd = tx({ amount: 25, currency: 'USD', fx_rate: 18.6906, amount_mxn: round2(25 * 18.6906) });
eq(usd.amount_mxn, 467.27, '25 USD × 18.6906 = 467.27 MXN');
eq(totals([usd]).spend, 467.27, 'estadísticas consolidan en MXN con el tipo de cambio guardado');

// ---------- Importador ----------
group('Importador Spendee');
const H = ['Date', 'Wallet', 'Type', 'Category name', 'Amount', 'Currency', 'Note', 'Labels', 'Author'];
const m = autoMap(H);
eq([m.date, m.amount, m.category, m.wallet, m.description, m.labels, m.type, m.currency], ['Date', 'Amount', 'Category name', 'Wallet', 'Note', 'Labels', 'Type', 'Currency'], 'mapeo automático de columnas Spendee');
eq(autoMap(['Fecha', 'Importe', 'Categoría', 'Descripción']).description, 'Descripción', 'mapeo en español');
ok(parseDate('2021-03-04T18:22:11+00:00')?.toISOString() === '2021-03-04T18:22:11.000Z', 'fecha ISO con zona');
eq(parseDate('14/08/2023')?.getDate(), 14, 'fecha día/mes');
eq(parseDate('08/14/2023', false)?.getMonth(), 7, 'fecha mes/día');
eq(parseDate('31/02/2023'), null, 'fecha imposible = error');
ok(parseDate(45000) instanceof Date, 'número de serie de Excel');
eq(guessDayFirst(['13/01/2024', '02/01/2024']), true, 'adivina día/mes');
eq(guessDayFirst(['01/13/2024']), false, 'adivina mes/día');
eq(parseType('Expense', -5), 'expense', 'tipo Expense');
eq(parseType('', 50, true), 'income', 'sin tipo + positivo en archivo con negativos = ingreso');
eq(parseType('Transfer', -5), 'transfer', 'tipo transferencia');
const cats = [{ id: 'A', name: 'Alimentos y bebidas' }, { id: 'S', name: 'Supermercado' }];
eq(suggestCategory('Food & Drink', cats), 'A', 'sinónimo Food & Drink');
eq(suggestCategory('GROCERIES', cats), 'S', 'sinónimo sin mayúsculas');
eq(suggestCategory('Bebé', cats), null, 'categoría desconocida → crear nueva');
const rows = [
  { Date: '2021-03-04T18:22:11+00:00', Wallet: 'Personal', Type: 'Expense', 'Category name': 'Food & Drink', Amount: '-120.5', Currency: 'MXN', Note: 'Tacos', Labels: '' },
  { Date: '2021-03-04T18:22:11+00:00', Wallet: 'Personal', Type: 'Expense', 'Category name': 'Food & Drink', Amount: '-120.5', Currency: 'MXN', Note: 'Tacos', Labels: '' },
  { Date: '2021-04-10', Wallet: 'Personal', Type: 'Expense', 'Category name': 'Travel', Amount: '-80', Currency: 'USD', Note: 'Hotel', Labels: 'NY 2021, Viajes' },
  { Date: 'xx', Wallet: 'Personal', Type: 'Expense', 'Category name': 'X', Amount: '-1', Currency: 'MXN' },
  { Date: '2021-04-11', Wallet: 'Personal', Type: 'Expense', 'Category name': 'X', Amount: 'abc', Currency: 'MXN' },
  { Date: '2021-04-12', Wallet: 'Vieja', Type: 'Expense', 'Category name': 'X', Amount: '-5', Currency: 'MXN' },
  { Date: '2021-04-13', Wallet: 'Personal', Type: 'Expense', 'Category name': 'X', Amount: '-7', Currency: 'JPY' },
];
const res = buildRows(rows, {
  map: m, walletFor: w => (w === 'Personal' ? 'W' : null), categoryFor: () => 'c', fxFor: c => (c === 'USD' ? 20 : 0),
  existingHashes: new Set(),
});
eq(res.ok.length, 2, '2 filas válidas');
eq(res.duplicates.length, 1, 'duplicado dentro del archivo detectado');
eq(res.errors.map(e => e.row), [5, 6, 8], 'errores: fecha mala, importe malo, falta tipo de cambio JPY');
eq(res.skipped.length, 1, 'cartera sin asignar se omite');
const h = res.ok[1];
eq([h.amount, h.currency, h.fx_rate, h.amount_mxn, h.tags], [80, 'USD', 20, 1600, ['NY 2021', 'Viajes']], 'USD convertido y etiquetas separadas');
const res2 = buildRows(rows.slice(0, 1), { map: m, walletFor: () => 'W', categoryFor: () => 'c', existingHashes: new Set([res.ok[0].import_hash]) });
eq(res2.duplicates.length, 1, 'duplicado contra lo ya existente');
// Volumen: 20,000 filas en < 3 s
const big = Array.from({ length: 20000 }, (_, i) => ({ Date: `2020-01-${String(1 + (i % 28)).padStart(2, '0')}`, Wallet: 'Personal', Type: 'Expense', 'Category name': 'Food', Amount: String(-(i + 1)), Currency: 'MXN', Note: 'n' + i }));
const t0 = performance.now();
const rb = buildRows(big, { map: m, walletFor: () => 'W', categoryFor: () => 'c', existingHashes: new Set() });
const ms = performance.now() - t0;
ok(rb.ok.length === 20000 && ms < 3000, `20,000 filas procesadas en ${Math.round(ms)} ms`);

// ---------- Recurrentes ----------
group('Gastos recurrentes');
eq(nextDate('2026-01-31', 'monthly'), '2026-02-28', 'mensual 31-ene → 28-feb');
eq(nextDate('2026-02-28', 'monthly'), '2026-03-28', 'mensual sigue el día');
eq(nextDate('2026-11-12', 'biweekly'), '2026-11-26', 'quincenal');
eq(nextDate('2024-02-29', 'yearly'), '2025-02-28', 'anual año bisiesto');
eq(dueOccurrences({ active: true, next_date: '2026-11-01', frequency: 'weekly' }, new Date(2026, 10, 16)), ['2026-11-01', '2026-11-08', '2026-11-15'], 'pendientes por confirmar');
eq(dueOccurrences({ active: false, next_date: '2026-11-01', frequency: 'weekly' }, new Date(2026, 10, 16)), [], 'inactivo no genera');

// ---------- Análisis ----------
group('Análisis inteligente (solo datos reales)');
const now = new Date(2026, 10, 20);
const ins = computeInsights({
  txs: [tx({ occurred_at: new Date(2026, 10, 5).toISOString(), amount_mxn: 1200 }), tx({ occurred_at: new Date(2026, 9, 5).toISOString(), amount_mxn: 1000 }),
    tx({ occurred_at: new Date(2026, 8, 5).toISOString(), amount_mxn: 500 })],
  catName: () => 'Restaurantes', catIcon: () => '🍝', ref: now,
});
const pace = ins.find(i => i.id === 'pace');
ok(pace && pace.title.includes('20%') && pace.title.includes('más'), 'ritmo: 1,200 vs 1,000 = 20% más', pace?.title);
const chg = ins.find(i => i.id.startsWith('chg-'));
ok(chg && chg.title.includes('100%') && chg.title.includes('subió'), 'cambio por categoría: 500 → 1,000 = subió 100%', chg?.title);
eq(computeInsights({ txs: [], catName: () => '' })[0].id, 'empty', 'sin datos no inventa nada');

// ---------- Sincronización / offline ----------
group('Sin internet + sincronización (servidor simulado)');
function fakeServer() {
  const rows = new Map(); let online = false; let clock = Date.parse('2026-01-01T00:00:00Z'); let calls = 0;
  return {
    rows, setOnline: v => (online = v), get calls() { return calls; },
    async upsert(table, list) {
      calls++;
      if (!online) throw new TypeError('Failed to fetch');
      for (const r of list) {
        if (r.amount <= 0) { const e = new Error('violates check constraint'); e.status = 400; throw e; }
        clock += 1000; rows.set(table + ':' + r.id, { ...r, updated_at: new Date(clock).toISOString() });
      }
    },
    async pull(table, since) {
      if (!online) throw new TypeError('Failed to fetch');
      return [...rows.entries()].filter(([k, v]) => k.startsWith(table + ':') && v.updated_at > since).map(([, v]) => v);
    },
  };
}
const dbName = 'fh-test-' + Date.now();
const db = await openDb(dbName);
const srv = fakeServer();
const local = new Map();
const hooks = {
  readRows: async (table, ids) => ids.map(id => local.get(id)).filter(Boolean),
  onRows: (table, rows) => rows.forEach(r => local.set(r.id, r)),
};
// 1) sin internet: registrar 3 gastos
const offline = [tx({ amount: 20, amount_mxn: 20 }), tx({ amount: 35, amount_mxn: 35 }), tx({ amount: 50, amount_mxn: 50, _receipt_local: 'data:x' })];
offline.forEach(r => local.set(r.id, r));
await putRows(db, 'transactions', offline);
let box = await getOutbox(db);
eq(box.length, 3, 'sin internet: 3 movimientos guardados en el teléfono y marcados como pendientes');
let threw = false;
try { await pushAll(db, srv, hooks); } catch { threw = true; }
box = await getOutbox(db);
ok(threw && box.length === 3, 'intento de subir sin red falla sin perder nada');
// 2) "cerrar la app": reabrir la base y seguir teniendo los pendientes
db.close();
const db2 = await openDb(dbName);
eq((await getAll(db2, 'transactions')).length, 3, 'tras cerrar y reabrir la app, los movimientos siguen ahí');
eq((await getOutbox(db2)).length, 3, 'y siguen pendientes de subir');
// 3) vuelve el internet
srv.setOnline(true);
const p1 = await pushAll(db2, srv, hooks);
eq(p1.pushed, 3, 'al volver la red se suben los 3');
eq((await getOutbox(db2)).length, 0, 'bandeja de salida vacía');
// 4) reintento (p.ej. se perdió la respuesta): subir otra vez NO duplica
await putRows(db2, 'transactions', offline);
await pushAll(db2, srv, hooks);
eq([...srv.rows.keys()].filter(k => k.startsWith('transactions:')).length, 3, 'reintentos no crean duplicados (mismo id)');
ok(![...srv.rows.values()].some(r => '_receipt_local' in r), 'campos locales (_…) no se envían al servidor');
// 5) fila inválida no bloquea a las demás
const bad = tx({ amount: 0, amount_mxn: 0 }), good = tx({ amount: 77, amount_mxn: 77 });
local.set(bad.id, bad); local.set(good.id, good);
await putRows(db2, 'transactions', [bad, good]);
const p2 = await pushAll(db2, srv, hooks);
eq([p2.pushed, p2.failed], [1, 1], 'una fila con error no bloquea a las demás');
const left = await getOutbox(db2);
ok(left.length === 1 && left[0].error, 'la fila con error queda marcada (no se pierde)', left[0]?.error);
// 6) pull: lo que registró la otra persona llega; lo pendiente local no se pisa
const fromAndres = tx({ amount: 2500, amount_mxn: 2500, description: 'Súper (Andrés)' });
await srv.upsert('transactions', [fromAndres]);
const editedLocally = { ...offline[0], description: 'editado sin red' };
local.set(editedLocally.id, editedLocally);
await putRows(db2, 'transactions', [editedLocally]);
srv.rows.set('transactions:' + offline[0].id, { ...offline[0], description: 'versión vieja del servidor', updated_at: '2030-01-01T00:00:00Z' });
await pullAll(db2, srv, hooks);
ok(local.get(fromAndres.id)?.description === 'Súper (Andrés)', 'llega el gasto de Hogar registrado en otro teléfono');
eq(local.get(offline[0].id).description, 'editado sin red', 'una edición local pendiente no se pisa con la del servidor');
eq(cleanForServer({ a: 1, _b: 2 }), { a: 1 }, 'limpieza de campos locales');
db2.close(); indexedDB.deleteDatabase(dbName);

// ---------- Resultado ----------
const pass = results.filter(r => r.pass).length;
const el = document.getElementById('out');
let html = `<h1>${pass === results.length ? '✅' : '❌'} ${pass}/${results.length} pruebas</h1>`;
let g = '';
for (const r of results) {
  if (r.g !== g) { g = r.g; html += `<h3>${g}</h3>`; }
  html += `<div class="${r.pass ? 'p' : 'f'}">${r.pass ? '✔' : '✘'} ${r.name}${r.pass ? '' : ' — ' + r.extra}</div>`;
}
el.innerHTML = html;
window.__results = { pass, total: results.length, failed: results.filter(r => !r.pass) };
