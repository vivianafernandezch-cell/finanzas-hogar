import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { useStore, Seg, BarChart, Delta, DayGroups, Empty, CatIcon, Sheet } from './common.js';
import { personalWallet, householdWallet, visibleTx, prefs, recurringOf, budgetsOf } from '../store.js';
import { filterTx, totals, monthlySeries, byCategory, pctChange } from '../logic/stats.js';
import { periodRange, previousRange, comparableRange, money, monthName, cap, ymd, addMonths } from '../logic/util.js';
import { dueOccurrences } from '../logic/recurring.js';
import { computeInsights } from '../logic/insights.js';

export const PERIODS = [['month', 'Este mes'], ['prev', 'Mes anterior'], ['3m', '3 meses'], ['year', 'Este año'], ['custom', 'Personalizado']];

export function WalletSwitch({ value, onChange, allowBoth = false }) {
  const pw = personalWallet(), hw = householdWallet();
  const opts = [[pw?.id, 'Mis gastos'], ...(hw ? [[hw.id, 'Hogar']] : []), ...(allowBoth && hw ? [['both', 'Ambas']] : [])];
  return html`<${Seg} value=${value} onChange=${onChange} options=${opts} />`;
}

export function useWallet(key = 'homeWallet') {
  const [w, setW] = useState(() => prefs.get(key, null) || personalWallet()?.id);
  const valid = w === 'both' || (w && personalWallet() && (w === personalWallet().id || w === householdWallet()?.id)) ? w : personalWallet()?.id;
  return [valid, v => { prefs.set(key, v); setW(v); }];
}
export const walletIdsFor = w => w === 'both' ? [personalWallet()?.id, householdWallet()?.id].filter(Boolean) : [w];

export function PeriodPicker({ period, setPeriod, custom, setCustom }) {
  const [open, setOpen] = useState(false);
  return html`<div>
    <div class="chips">${PERIODS.map(([k, l]) => html`<button class=${'chip' + (period === k ? ' on' : '')}
      onClick=${() => { if (k === 'custom') setOpen(true); setPeriod(k); }}>${l}</button>`)}</div>
    ${open && html`<${Sheet} title="Período personalizado" onClose=${() => setOpen(false)}>
      <div class="sheet-body">
        <div class="grid2">
          <div class="field"><label>Desde</label><input type="date" value=${custom.from} onInput=${e => setCustom({ ...custom, from: e.target.value })} /></div>
          <div class="field"><label>Hasta</label><input type="date" value=${custom.to} onInput=${e => setCustom({ ...custom, to: e.target.value })} /></div>
        </div>
        <button class="btn primary block" onClick=${() => setOpen(false)}>Aplicar</button>
      </div><//>`}
  </div>`;
}

export function usePeriod(prefix) {
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState(() => ({ from: ymd(addMonths(new Date(), -1)), to: ymd(new Date()) }));
  const range = periodRange(period, custom);
  return { period, setPeriod, custom, setCustom, range };
}

export function Home({ openTx, go, onAdd }) {
  const S = useStore();
  const [wallet, setWallet] = useWallet();
  const p = usePeriod();
  const ids = walletIdsFor(wallet);
  const all = useMemo(() => visibleTx().filter(t => ids.includes(t.wallet_id)), [S.version, wallet]);
  const cur = filterTx(all, { from: p.range.from, to: p.range.to });
  const now = new Date();
  const cmp = comparableRange(p.range, now);
  const prev = filterTx(all, cmp);
  const prevFull = cmp.partial ? totals(filterTx(all, previousRange(p.range))).spend : null;
  const tc = totals(cur), tp = totals(prev);
  const series = monthlySeries(all, 6, p.period === 'prev' ? addMonths(new Date(), -1) : new Date());
  const selKey = p.period === 'month' || p.period === 'prev' ? series[series.length - 1].key : null;
  const recent = [...all].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 12);
  const topCats = byCategory(cur, id => S.categories.get(id)?.parent_id).slice(0, 4);
  const due = recurringOf().filter(r => ids.includes(r.wallet_id)).reduce((n, r) => n + dueOccurrences(r).length, 0);
  const insight = useMemo(() => {
    const list = computeInsights({ txs: all, catName: id => S.categories.get(id)?.name || 'Sin categoría', catIcon: id => S.categories.get(id)?.icon || '•', parentOf: id => S.categories.get(id)?.parent_id, budgets: ids.flatMap(budgetsOf) });
    return list.find(i => i.tone === 'bad') || list[0];
  }, [S.version, wallet]);
  const prevLabel = p.period === 'month' ? `Al día ${now.getDate()} de ${monthName(addMonths(now, -1))} ibas en` : cmp.partial ? 'Mismo tramo del período anterior:' : 'Período anterior:';

  return html`<div class="screen">
    <div class="topbar">
      <div class="grow"><${WalletSwitch} value=${wallet} onChange=${setWallet} /></div>
      <${SyncBadge} onClick=${() => go('settings')} />
    </div>
    <${PeriodPicker} ...${p} />

    <div class="card hero" style="margin-top:12px">
      <div class="row between"><span class="muted small" style="font-weight:600">Gastado · ${p.range.label}</span><${Delta} pct=${pctChange(tc.spend, tp.spend)} /></div>
      <div class="big num">${money(tc.spend)}</div>
      <div class="tiny muted">${tp.spend ? `${prevLabel} ${money(tp.spend)}${prevFull ? ` · completo ${money(prevFull)}` : ''}` : ''}</div>
      <div class="kpis">
        <div class="kpi"><div class="l">Ingresos</div><div class="v inc num">${money(tc.income, 'MXN', { decimals: 0 })}</div></div>
        <div class="kpi"><div class="l">Flujo neto</div><div class=${'v num ' + (tc.net < 0 ? 'exp' : 'inc')}>${money(tc.net, 'MXN', { sign: true, decimals: 0 })}</div></div>
        <div class="kpi"><div class="l">Movimientos</div><div class="v num">${cur.length}</div></div>
      </div>
      <div style="margin-top:16px">
        <${BarChart} data=${series.map(s => ({ label: cap(monthName(s.date, true)), value: s.spend, dim: s.key !== selKey, key: s.key }))}
          onPick=${d => { p.setCustom({ from: d.key + '-01', to: ymd(new Date(new Date(d.key + '-01T12:00').getFullYear(), new Date(d.key + '-01T12:00').getMonth() + 1, 0)) }); p.setPeriod('custom'); }} />
      </div>
    </div>

    ${due > 0 && html`<button class="banner" onClick=${() => go('recurring')}>🔔 <span class="grow"><b>${due} pago${due > 1 ? 's' : ''} programado${due > 1 ? 's' : ''}</b> por confirmar</span><span class="chev">›</span></button>`}
    ${insight && insight.id !== 'empty' && html`<button class="banner" onClick=${() => go('insights')}>${insight.icon}<span class="grow small">${insight.title}</span><span class="chev">›</span></button>`}

    ${topCats.length > 0 && html`<div class="card">
      <div class="row between"><h3>En qué se va</h3><button class="link small" onClick=${() => go('stats')}>Estadísticas ›</button></div>
      ${topCats.map(c => { const cat = S.categories.get(c.id); const pct = tc.spend ? Math.round(c.total / tc.spend * 100) : 0; return html`<div class="catrow">
        <${CatIcon} cat=${cat} size="sm" />
        <div class="grow"><div class="row between small"><b>${cat?.name || 'Sin categoría'}</b><span class="num">${money(c.total)} · ${pct}%</span></div>
          <div class="hbar" style="margin-top:6px"><i style=${`width:${pct}%;background:${cat?.color || '#888'}`}></i></div></div>
      </div>`; })}
    </div>`}

    <div class="row between" style="margin:18px 4px 4px"><b>Últimos movimientos</b><button class="link small" onClick=${() => go('history')}>Ver todo ›</button></div>
    ${recent.length ? html`<${DayGroups} txs=${recent} onOpen=${openTx} showWallet=${wallet === 'both'} />`
      : html`<${Empty} e="🪙">Aún no hay movimientos.<br/>Toca <b>+</b> para registrar el primero.<//>`}
  </div>`;
}

export function SyncBadge({ onClick }) {
  const S = useStore();
  if (S.mode !== 'cloud') return html`<button class="iconbtn" onClick=${onClick} title="Modo local (sin nube)">📱</button>`;
  const st = S.sync;
  const cls = !st.online ? 'off' : st.error && st.failed ? 'err' : st.pending ? 'pending' : '';
  const title = !st.online ? 'Sin conexión — guardado en el teléfono' : st.pending ? `${st.pending} cambio(s) por subir` : 'Todo sincronizado';
  return html`<button class="iconbtn" onClick=${onClick} title=${title} aria-label=${title}>
    <span class=${'syncdot ' + cls}></span>${st.pending ? html`<span class="tiny" style="margin-left:3px">${st.pending}</span>` : null}</button>`;
}
