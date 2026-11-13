// "Análisis inteligente" v1: SOLO cálculos sobre tus datos reales (nada sale del teléfono).
// Cada insight trae los números que lo respaldan. Arquitectura lista para un proveedor de IA:
// ver `aiProvider` al final — hoy está desactivado.
import { filterTx, totals, byCategory, monthlySeries, pctChange, monthProjection, spendOf, budgetStatus } from './stats.js';
import { startOfMonth, addMonths, money, monthName, round2, daysInMonth } from './util.js';

/**
 * ctx: { txs (ya filtrados por cartera), catName(id), catIcon(id), parentOf(id), budgets, ref:Date }
 * Devuelve [{ id, tone:'good'|'bad'|'info', icon, title, detail }]
 */
export function computeInsights(ctx) {
  const { txs, catName, catIcon = () => '•', parentOf, budgets = [], ref = new Date() } = ctx;
  const out = [];
  const som = startOfMonth(ref), nextM = addMonths(som, 1), prevM = addMonths(som, -1);
  const day = ref.getDate(), dim = daysInMonth(ref);
  const cur = filterTx(txs, { from: som, to: nextM });
  const prev = filterTx(txs, { from: prevM, to: som });
  // Comparación justa: mismo número de días del mes anterior
  const prevSameDays = filterTx(txs, { from: prevM, to: new Date(prevM.getFullYear(), prevM.getMonth(), day + 1) });
  const tc = totals(cur), tp = totals(prev), tps = totals(prevSameDays);

  if (!txs.some(t => !t.deleted_at)) return [{ id: 'empty', tone: 'info', icon: '✨', title: 'Aún no hay datos', detail: 'Registra algunos gastos y aquí aparecerán tus análisis.' }];

  // 1) Ritmo del mes vs mismo punto del mes anterior
  if (tps.spend > 0 && tc.spend > 0) {
    const p = pctChange(tc.spend, tps.spend);
    out.push({
      id: 'pace', tone: p > 5 ? 'bad' : p < -5 ? 'good' : 'info', icon: p > 0 ? '📈' : '📉',
      title: `Llevas ${money(tc.spend)} en ${monthName(ref)}: ${Math.round(Math.abs(p))}% ${p >= 0 ? 'más' : 'menos'} que a estas alturas de ${monthName(prevM)}`,
      detail: `Al día ${day} de ${monthName(prevM)} ibas en ${money(tps.spend)}. Mes completo de ${monthName(prevM)}: ${money(tp.spend)}.`,
    });
  }
  // 2) Proyección
  if (tc.spend > 0 && day >= 5 && day < dim) {
    const proj = monthProjection(tc.spend, ref);
    out.push({ id: 'proj', tone: tp.spend && proj > tp.spend * 1.1 ? 'bad' : 'info', icon: '🔮',
      title: `A este ritmo cerrarías ${monthName(ref)} en ~${money(Math.round(proj))}`,
      detail: `Promedio diario: ${money(round2(tc.spend / day))} × ${dim} días.${tp.spend ? ` ${monthName(prevM)} cerró en ${money(tp.spend)}.` : ''}` });
  }
  // 3) Top 3 categorías del mes
  const topC = byCategory(cur, parentOf).slice(0, 3);
  if (topC.length) {
    out.push({ id: 'top', tone: 'info', icon: '🏆', title: `Tus categorías con más gasto en ${monthName(ref)}`,
      detail: topC.map((c, i) => `${i + 1}. ${catIcon(c.id)} ${catName(c.id)}: ${money(c.total)} (${tc.spend ? Math.round(c.total / tc.spend * 100) : 0}%)`).join('\n') });
  }
  // 4) Cambios por categoría (mes anterior completo vs el previo) — lo que más subió y bajó
  const prev2 = filterTx(txs, { from: addMonths(som, -2), to: prevM });
  const a = new Map(byCategory(prev, parentOf).map(c => [c.id, c.total]));
  const b = new Map(byCategory(prev2, parentOf).map(c => [c.id, c.total]));
  const changes = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id) || 0, y = b.get(id) || 0;
    if (Math.max(x, y) < 300) continue;                       // ignorar montos chicos
    const p = pctChange(x, y);
    if (p === null || Math.abs(p) >= 15) changes.push({ id, x, y, p, diff: x - y });
  }
  changes.sort((m, n) => Math.abs(n.diff) - Math.abs(m.diff));
  for (const c of changes.slice(0, 3)) {
    const up = c.diff > 0;
    out.push({ id: 'chg-' + c.id, tone: up ? 'bad' : 'good', icon: up ? '⬆️' : '⬇️',
      title: c.p === null
        ? `${catIcon(c.id)} ${catName(c.id)}: ${money(c.x)} en ${monthName(prevM)} (sin gasto el mes previo)`
        : `${catIcon(c.id)} ${catName(c.id)} ${up ? 'subió' : 'bajó'} ${Math.round(Math.abs(c.p))}% en ${monthName(prevM)}`,
      detail: `${money(c.y)} en ${monthName(addMonths(som, -2))} → ${money(c.x)} en ${monthName(prevM)} (${up ? '+' : '−'}${money(Math.abs(c.diff))}).` });
  }
  // 5) Promedios de 6 meses de las 3 categorías más grandes
  const six = filterTx(txs, { from: addMonths(som, -6), to: som });
  const monthsWithData = monthlySeries(six, 6, prevM).filter(m => m.spend !== 0).length;
  if (monthsWithData >= 2) {
    const big = byCategory(six, parentOf).slice(0, 3);
    out.push({ id: 'avg', tone: 'info', icon: '📊', title: `Promedio mensual (últimos ${monthsWithData} meses completos)`,
      detail: [`Total: ${money(round2(totals(six).spend / monthsWithData))} al mes`,
        ...big.map(c => `${catIcon(c.id)} ${catName(c.id)}: ${money(round2(c.total / monthsWithData))} al mes`)].join('\n') });
  }
  // 6) Gasto inusual: el más grande del mes vs su categoría
  const exp = cur.filter(t => t.type === 'expense');
  if (exp.length) {
    const biggest = exp.reduce((m, t) => (+t.amount_mxn > +m.amount_mxn ? t : m));
    const hist = filterTx(txs, { from: addMonths(som, -12), to: som }).filter(t => t.type === 'expense' && t.category_id === biggest.category_id).map(t => +t.amount_mxn).sort((x, y) => x - y);
    const med = hist.length ? hist[Math.floor(hist.length / 2)] : 0;
    if (med && +biggest.amount_mxn >= med * 4 && +biggest.amount_mxn >= 500) {
      out.push({ id: 'unusual', tone: 'info', icon: '🔎', title: `Gasto fuera de lo normal: ${money(biggest.amount_mxn)} en ${catName(biggest.category_id)}`,
        detail: `"${biggest.description || 'sin descripción'}" — tu gasto típico en esa categoría es ${money(med)}.` });
    }
  }
  // 7) Presupuestos en riesgo
  for (const bu of budgets.filter(x => !x.deleted_at)) {
    const st = budgetStatus(bu, cur.map(t => ({ ...t, _parent: parentOf?.(t.category_id) })));
    const expected = (day / dim) * 100;
    if (st.pct >= 100) out.push({ id: 'bud-' + bu.id, tone: 'bad', icon: '🚨', title: `Te pasaste del presupuesto de ${bu.category_id ? catName(bu.category_id) : 'la cartera'}`, detail: `${money(st.spent)} de ${money(st.amount)} (${st.pct}%).` });
    else if (st.pct >= 80 || st.pct > expected + 25) out.push({ id: 'bud-' + bu.id, tone: 'bad', icon: '⚠️', title: `${bu.category_id ? catName(bu.category_id) : 'Presupuesto total'}: ya usaste ${st.pct}%`, detail: `Quedan ${money(st.left)} para ${dim - day} días.` });
  }
  // 8) Ingresos vs gastos
  if (tc.income > 0) out.push({ id: 'net', tone: tc.net >= 0 ? 'good' : 'bad', icon: tc.net >= 0 ? '💚' : '🔴',
    title: tc.net >= 0 ? `Vas ${money(tc.net)} arriba este mes` : `Este mes llevas ${money(-tc.net)} más de gasto que de ingreso`,
    detail: `Ingresos ${money(tc.income)} · Gastos ${money(tc.spend)}${tc.income ? ` · Ahorro ${Math.round(tc.net / tc.income * 100)}%` : ''}` });
  return out;
}

// Respuestas rápidas a preguntas frecuentes (sin IA, con datos reales)
export function answerCategoryQuestion(txs, categoryIds, from, to) {
  const t = filterTx(txs, { from, to, categoryIds });
  const total = t.reduce((a, x) => a + spendOf(x), 0);
  return { total: round2(total), count: t.filter(x => x.type === 'expense').length };
}

// Gancho para IA futura: NO está activo. Si algún día se conecta, debe pedir autorización explícita
// y mandar solo agregados (totales por categoría/mes), nunca descripciones ni cuentas.
export const aiProvider = { enabled: false, name: null, async ask() { throw new Error('IA no configurada'); } };
