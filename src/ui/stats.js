import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { useStore, BarChart, Donut, Delta, CatIcon, Empty, Seg, DayGroups, Sheet } from './common.js';
import { visibleTx, recurringOf, budgetsOf } from '../store.js';
import { filterTx, totals, byCategory, monthlySeries, groupSum, pctChange, weekdaySeries, spendOf, dailySeries, monthlyAverage } from '../logic/stats.js';
import { previousRange, comparableRange, money, monthName, cap, addMonths, startOfMonth, round2, ymd, addDays, periodRange } from '../logic/util.js';
import { monthlyEquivalent, FREQS } from '../logic/recurring.js';
import { computeInsights } from '../logic/insights.js';
import { WalletSwitch, useWallet, walletIdsFor, PeriodPicker, usePeriod } from './home.js';

const WD = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const catOf = (S, id) => S.categories.get(id);
// En "Ambas" las categorías de cada cartera son distintas → agrupar por nombre
const groupKey = (S, id) => { const c = S.categories.get(id); const p = c?.parent_id ? S.categories.get(c.parent_id) : c; return p ? p.name : '__none'; };

export function Stats({ openTx, go }) {
  const S = useStore();
  const [wallet, setWallet] = useWallet('statsWallet');
  const p = usePeriod();
  const [detail, setDetail] = useState(null);
  const ids = walletIdsFor(wallet);
  const all = useMemo(() => visibleTx().filter(t => ids.includes(t.wallet_id)), [S.version, wallet]);
  const cur = filterTx(all, p.range);
  const cmp = comparableRange(p.range);
  const prev = filterTx(all, cmp);
  const tc = totals(cur), tp = totals(prev);
  const days = Math.max(1, Math.round((Math.min(p.range.to, new Date(Date.now() + 864e5)) - p.range.from) / 864e5));
  const avg = monthlyAverage(all, 12);

  const byName = (txs) => {
    const m = new Map();
    for (const t of txs) { const s = spendOf(t); if (!s) continue; const k = groupKey(S, t.category_id); const r = m.get(k) || { key: k, total: 0, ids: new Set() }; r.total += s; r.ids.add(t.category_id); m.set(k, r); }
    return [...m.values()].map(r => ({ ...r, total: round2(r.total) })).filter(r => r.total).sort((a, b) => b.total - a.total);
  };
  const cats = byName(cur);
  const prevCats = new Map(byName(prev).map(c => [c.key, c.total]));
  const repr = name => [...S.categories.values()].find(c => c.name === name && ids.includes(c.wallet_id)) || { name: 'Sin categoría', icon: '❔', color: '#8E8E93' };
  const series12 = monthlySeries(all, 12);
  const weekly = weeklySeries(all, 12);
  const byAcc = groupSum(cur, t => t.account_id || '__none');
  const byCur = groupSum(cur, t => t.currency, t => t.type === 'expense' ? +t.amount : 0).map(r => ({ ...r, mxn: round2(cur.filter(t => t.currency === r.key).reduce((a, t) => a + spendOf(t), 0)) }));
  const byPerson = S.wallets.get(wallet)?.kind === 'household' ? groupSum(cur, t => t.paid_by || t.created_by) : [];
  const byWallet = wallet === 'both' ? groupSum(cur, t => S.wallets.get(t.wallet_id)?.kind) : [];
  const byTag = groupSum(cur.filter(t => t.tags?.length), t => t.tags[0]);
  const wk = weekdaySeries(cur);
  const daily = p.period === 'month' || p.period === 'prev' || (p.period === 'custom' && days <= 62) ? dailySeries(cur, p.range.from, p.range.to) : null;
  const rec = recurringOf().filter(r => ids.includes(r.wallet_id) && r.active && r.type === 'expense');
  const recMonthly = round2(rec.reduce((a, r) => a + monthlyEquivalent(r) * (r.currency === 'MXN' ? 1 : 0), 0));
  const changes = [...new Set([...cats.map(c => c.key), ...prevCats.keys()])].map(k => {
    const a = cats.find(c => c.key === k)?.total || 0, b = prevCats.get(k) || 0; return { k, a, b, d: round2(a - b), p: pctChange(a, b) };
  }).filter(x => Math.abs(x.d) >= 1).sort((x, y) => y.d - x.d);

  return html`<div class="screen">
    <div class="topbar"><h1>Estadísticas</h1><button class="iconbtn" onClick=${() => go('insights')} title="Análisis inteligente">✨</button></div>
    <${WalletSwitch} value=${wallet} onChange=${setWallet} allowBoth />
    <div style="margin-top:10px"><${PeriodPicker} ...${p} /></div>

    <div class="card" style="margin-top:12px">
      <div class="row between"><span class="muted small" style="font-weight:600">Gasto · ${p.range.label}</span><${Delta} pct=${pctChange(tc.spend, tp.spend)} /></div>
      <div style="font-size:30px;font-weight:750" class="num">${money(tc.spend)}</div>
      <div class="kpis">
        <div class="kpi"><div class="l">Promedio diario</div><div class="v num">${money(Math.round(tc.spend / days))}</div></div>
        <div class="kpi"><div class="l">Prom. mensual</div><div class="v num">${money(avg.avg)}</div></div>
        <div class="kpi"><div class="l">${cmp.partial ? 'Anterior (mismo tramo)' : 'Período anterior'}</div><div class="v num">${money(tp.spend)}</div></div>
      </div>
    </div>

    ${!cur.length ? html`<${Empty} e="📊">No hay movimientos en este período<//>` : html`
    <div class="card">
      <h3>Por categoría</h3>
      <div class="row" style="justify-content:center;margin-bottom:6px">
        <${Donut} slices=${cats.map(c => ({ value: c.total, color: repr(c.key).color }))} center=${['Total', money(tc.spend)]} />
      </div>
      ${cats.map(c => { const cat = repr(c.key); const pct = tc.spend ? c.total / tc.spend * 100 : 0; return html`<button class="catrow" onClick=${() => setDetail({ name: c.key, ids: [...c.ids] })}>
        <${CatIcon} cat=${cat} size="sm" />
        <div class="grow"><div class="row between small"><b class="ellipsis">${c.key === '__none' ? 'Sin categoría' : c.key}</b><span class="num">${money(c.total)}</span></div>
          <div class="row" style="gap:8px;margin-top:5px"><div class="hbar grow"><i style=${`width:${pct}%;background:${cat.color}`}></i></div><span class="tiny muted num" style="width:34px;text-align:right">${pct.toFixed(pct < 10 ? 1 : 0)}%</span></div></div>
      </button>`; })}
    </div>

    <div class="card"><h3>Cambios vs período anterior</h3>
      ${changes.slice(0, 5).concat(changes.length > 5 ? changes.slice(-3) : []).filter((x, i, a) => a.indexOf(x) === i).map(x => html`<div class="row between small" style="padding:6px 0">
        <span>${repr(x.k).icon} ${x.k === '__none' ? 'Sin categoría' : x.k}</span>
        <span class="num"><span class="muted">${money(x.b)} → </span><b>${money(x.a)}</b> <span class=${x.d > 0 ? 'exp' : 'inc'}>${x.d > 0 ? '+' : '−'}${money(Math.abs(x.d))}</span></span></div>`)}
    </div>

    ${daily && html`<div class="card"><h3>Gasto diario</h3>
      <${BarChart} height=${110} data=${daily.map((d, i) => ({ label: (i % 5 === 0 ? String(+d.key.slice(8)) : ''), value: d.total, dim: d.key > ymd(new Date()) }))} /></div>`}
    ${byWallet.length > 1 && html`<${Breakdown} title="Por cartera" rows=${byWallet.map(r => ({ label: r.key === 'household' ? '🏠 Hogar' : '👤 Mis gastos', total: r.total }))} total=${tc.spend} />`}
    ${byPerson.length > 1 && html`<${Breakdown} title="¿Quién pagó? (Hogar)" rows=${byPerson.map(r => ({ label: r.key === S.user.id ? 'Yo' : (S.people[r.key]?.display_name || 'Otra persona'), total: r.total }))} total=${tc.spend} />`}
    <${Breakdown} title="Por cuenta / método de pago" rows=${byAcc.map(r => ({ label: r.key === '__none' ? 'Sin cuenta' : `${S.accounts.get(r.key)?.icon || ''} ${S.accounts.get(r.key)?.name || 'Cuenta de otra persona'}`, total: r.total }))} total=${tc.spend} />
    ${byCur.length > 1 || (byCur[0] && byCur[0].key !== 'MXN') ? html`<div class="card"><h3>Por moneda</h3>${byCur.map(r => html`<div class="row between small" style="padding:6px 0"><b>${r.key}</b><span class="num">${money(r.total, r.key)} <span class="muted">≈ ${money(r.mxn)}</span></span></div>`)}</div>` : null}
    ${byTag.length > 0 && html`<${Breakdown} title="Por etiqueta / viaje" rows=${byTag.map(r => ({ label: '#' + r.key, total: r.total, onClick: () => go('trip', { tag: r.key }) }))} total=${tc.spend} />`}
    <div class="card"><h3>Por día de la semana</h3>
      <${BarChart} height=${100} data=${wk.map((v, i) => ({ label: WD[i], value: v }))} /></div>`}

    <div class="card"><h3>Tendencia 12 meses</h3>
      <div class="row small" style="gap:12px;margin-bottom:6px"><span><i class="legend-dot" style="background:var(--expense)"></i> Gastos</span><span><i class="legend-dot" style="background:var(--income)"></i> Ingresos</span></div>
      <${BarChart} showIncome data=${series12.map(s => ({ label: monthName(s.date, true).slice(0, 1), value: s.spend, value2: s.income }))} />
      <div class="small muted" style="margin-top:8px">Promedio mensual (${avg.months} meses completos): <b class="num">${money(avg.avg)}</b></div>
    </div>
    <div class="card"><h3>Últimas 12 semanas</h3>
      <${BarChart} height=${100} data=${weekly.map((w, i) => ({ label: i % 2 ? '' : `${w.from.getDate()}/${w.from.getMonth() + 1}`, value: w.total }))} /></div>

    ${rec.length > 0 && html`<div class="card"><h3>Gastos recurrentes</h3>
      ${rec.map(r => html`<div class="row between small" style="padding:5px 0"><span>${S.categories.get(r.category_id)?.icon || '🔁'} ${r.description || S.categories.get(r.category_id)?.name} · <span class="muted">${FREQS[r.frequency]}</span></span><b class="num">${money(r.amount, r.currency)}</b></div>`)}
      <div class="small muted" style="margin-top:6px">Equivalente mensual (MXN): <b>${money(recMonthly)}</b></div></div>`}

    ${detail && html`<${CategoryDetail} detail=${detail} all=${all} onClose=${() => setDetail(null)} openTx=${openTx} />`}
  </div>`;
}

function Breakdown({ title, rows, total }) {
  if (!rows.length) return null;
  return html`<div class="card"><h3>${title}</h3>
    ${rows.map(r => { const pct = total ? Math.max(0, r.total / total * 100) : 0; return html`<button class="catrow" style="padding:6px 0" onClick=${r.onClick}>
      <div class="grow"><div class="row between small"><span class="ellipsis">${r.label}</span><span class="num">${money(r.total)} <span class="muted">${Math.round(pct)}%</span></span></div>
      <div class="hbar" style="margin-top:5px"><i style=${`width:${pct}%;background:var(--accent)`}></i></div></div></button>`; })}
  </div>`;
}

function weeklySeries(txs, n) {
  const today = new Date(); const monday = addDays(new Date(today.getFullYear(), today.getMonth(), today.getDate()), -((today.getDay() + 6) % 7));
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const from = addDays(monday, -7 * i), to = addDays(from, 7); out.push({ from, total: round2(filterTx(txs, { from, to }).reduce((a, t) => a + spendOf(t), 0)) }); }
  return out;
}

function CategoryDetail({ detail, all, onClose, openTx }) {
  const S = useStore();
  const catIds = [...S.categories.values()].filter(c => detail.ids.includes(c.id) || detail.ids.includes(c.parent_id) || c.name === detail.name).map(c => c.id);
  const txs = all.filter(t => catIds.includes(t.category_id) || (detail.name === '__none' && !t.category_id && spendOf(t)));
  const s12 = monthlySeries(txs, 12);
  const yearFrom = new Date(new Date().getFullYear(), 0, 1);
  const ytd = totals(filterTx(txs, { from: yearFrom })).spend;
  const last12 = totals(filterTx(txs, { from: addMonths(startOfMonth(new Date()), -12), to: startOfMonth(new Date()) })).spend;
  const avg6 = monthlyAverage(txs, 6);
  const cat = [...S.categories.values()].find(c => c.name === detail.name);
  const sorted = [...txs].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return html`<${Sheet} title=${(cat?.icon || '') + ' ' + (detail.name === '__none' ? 'Sin categoría' : detail.name)} onClose=${onClose} full>
    <div class="sheet-body">
      <div class="kpis" style="margin-top:0">
        <div class="kpi"><div class="l">Este año</div><div class="v num">${money(ytd)}</div></div>
        <div class="kpi"><div class="l">Prom. mensual 6m</div><div class="v num">${money(avg6.avg)}</div></div>
        <div class="kpi"><div class="l">Últimos 12m</div><div class="v num">${money(last12)}</div></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Por mes</h3>
        <${BarChart} data=${s12.map(s => ({ label: monthName(s.date, true).slice(0, 1), value: s.spend }))} color=${cat?.color || 'var(--accent)'} /></div>
      <${DayGroups} txs=${sorted} limit=${200} onOpen=${openTx} />
    </div><//>`;
}

// ---------- Análisis inteligente ----------
export function Insights({ back }) {
  const S = useStore();
  const [wallet, setWallet] = useWallet('insWallet');
  const ids = walletIdsFor(wallet);
  const list = useMemo(() => computeInsights({
    txs: visibleTx().filter(t => ids.includes(t.wallet_id)),
    catName: id => S.categories.get(id)?.name || 'Sin categoría', catIcon: id => S.categories.get(id)?.icon || '•',
    parentOf: id => S.categories.get(id)?.parent_id, budgets: ids.flatMap(budgetsOf),
  }), [S.version, wallet]);
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Análisis inteligente</h1></div>
    <${WalletSwitch} value=${wallet} onChange=${setWallet} allowBoth />
    <div style="margin-top:14px">${list.map(i => html`<div class=${'insight ' + i.tone}><div class="ii">${i.icon}</div><div><div class="tt">${i.title}</div><div class="dd">${i.detail}</div></div></div>`)}</div>
    <div class="tiny faint center" style="margin-top:14px">Calculado en tu teléfono con tus datos reales. Nada se envía a servicios externos.</div>
  </div>`;
}

// ---------- Viajes / etiquetas ----------
export function Trips({ back, go }) {
  const S = useStore();
  const all = visibleTx();
  const tags = new Map();
  for (const t of all) for (const g of t.tags || []) {
    const r = tags.get(g) || { tag: g, total: 0, n: 0, from: t.occurred_at, to: t.occurred_at };
    r.total += spendOf(t); r.n++; if (t.occurred_at < r.from) r.from = t.occurred_at; if (t.occurred_at > r.to) r.to = t.occurred_at; tags.set(g, r);
  }
  const list = [...tags.values()].sort((a, b) => b.to.localeCompare(a.to));
  const max = Math.max(1, ...list.map(x => x.total));
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Viajes y etiquetas</h1></div>
    ${!list.length ? html`<${Empty} e="🧳">Aún no usas etiquetas.<br/>Al registrar un gasto, abre <b>Detalles</b> y escribe una etiqueta como <i>Madrid 2026</i>.<//>` :
      html`<div class="list">${list.map(x => html`<button class="tx" onClick=${() => go('trip', { tag: x.tag })}>
        <div class="caticon" style="background:var(--accent-soft)">🏷️</div>
        <div class="grow"><div class="t1">${x.tag}</div><div class="t2">${x.n} movimientos · ${new Date(x.from).toLocaleDateString('es-MX')} – ${new Date(x.to).toLocaleDateString('es-MX')}</div>
          <div class="hbar" style="margin-top:6px"><i style=${`width:${x.total / max * 100}%;background:var(--accent)`}></i></div></div>
        <div class="amt num">${money(x.total)}</div></button>`)}</div>`}
  </div>`;
}

export function Trip({ tag, back, openTx }) {
  const S = useStore();
  const txs = visibleTx().filter(t => (t.tags || []).includes(tag)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const tt = totals(txs);
  const cats = byCategory(txs, id => S.categories.get(id)?.parent_id);
  const byDay = groupSum(txs, t => ymd(new Date(t.occurred_at))).sort((a, b) => a.key.localeCompare(b.key));
  const byCur = groupSum(txs, t => t.currency, t => t.type === 'expense' ? +t.amount : 0);
  const others = new Map();
  for (const t of visibleTx()) for (const g of t.tags || []) others.set(g, (others.get(g) || 0) + spendOf(t));
  const days = byDay.length;
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>#${tag}</h1></div>
    <div class="card hero"><div class="muted small">Costo total</div><div class="big num">${money(tt.spend)}</div>
      <div class="kpis"><div class="kpi"><div class="l">Días con gasto</div><div class="v">${days}</div></div>
      <div class="kpi"><div class="l">Por día</div><div class="v num">${money(round2(tt.spend / Math.max(1, days)))}</div></div>
      <div class="kpi"><div class="l">Movimientos</div><div class="v">${txs.length}</div></div></div></div>
    <div class="card"><h3>Por categoría</h3>${cats.map(c => { const cat = S.categories.get(c.id); return html`<div class="row between small" style="padding:6px 0"><span>${cat?.icon} ${cat?.name || 'Sin categoría'}</span><b class="num">${money(c.total)}</b></div>`; })}</div>
    <div class="card"><h3>Por día</h3><${BarChart} height=${110} data=${byDay.map(d => ({ label: d.key.slice(8), value: d.total }))} /></div>
    <div class="card"><h3>Por moneda</h3>${byCur.map(r => html`<div class="row between small" style="padding:6px 0"><b>${r.key}</b><span class="num">${money(r.total, r.key)}</span></div>`)}</div>
    ${others.size > 1 && html`<div class="card"><h3>Comparado con otros viajes/etiquetas</h3>${[...others.entries()].sort((a, b) => b[1] - a[1]).map(([g, v]) => html`<div class="row between small" style=${'padding:6px 0;' + (g === tag ? 'font-weight:750' : '')}><span>#${g}</span><span class="num">${money(v)}</span></div>`)}</div>`}
    <${DayGroups} txs=${txs} onOpen=${openTx} showWallet />
  </div>`;
}
