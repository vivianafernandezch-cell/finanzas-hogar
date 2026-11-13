import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact-htm.js';
import { useStore, DayGroups, Empty, Sheet, Seg } from './common.js';
import { visibleTx, categoriesOf, myAccounts, personalWallet, householdWallet } from '../store.js';
import { filterTx, totals } from '../logic/stats.js';
import { money } from '../logic/util.js';
import { TX_TYPES } from '../logic/seed.js';
import { WalletSwitch, useWallet, walletIdsFor } from './home.js';

const EMPTY_F = { from: '', to: '', categoryIds: [], accountIds: [], currency: '', tag: '', types: [] };

export function History({ openTx, initial }) {
  const S = useStore();
  const [wallet, setWallet] = useWallet('histWallet');
  const [q, setQ] = useState('');
  const [f, setF] = useState(() => ({ ...EMPTY_F, ...(initial || {}) }));
  const [showF, setShowF] = useState(false);
  const [limit, setLimit] = useState(150);
  const sentinel = useRef();

  const ids = walletIdsFor(wallet);
  const list = useMemo(() => {
    const catName = id => S.categories.get(id)?.name || '';
    // incluir subcategorías al filtrar por una categoría padre
    const catIds = f.categoryIds.length ? [...S.categories.values()].filter(c => f.categoryIds.includes(c.id) || f.categoryIds.includes(c.parent_id)).map(c => c.id) : [];
    return filterTx(visibleTx(), {
      walletIds: ids, q, catName, categoryIds: catIds, accountIds: f.accountIds, currency: f.currency || null, tag: f.tag || null,
      types: f.types, from: f.from ? new Date(f.from + 'T00:00:00') : null, to: f.to ? new Date(new Date(f.to + 'T00:00:00').getTime() + 864e5) : null,
    }).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [S.version, wallet, q, f]);
  const tt = totals(list);
  const activeCount = Object.entries(f).filter(([k, v]) => Array.isArray(v) ? v.length : v).length;

  useEffect(() => { setLimit(150); }, [q, f, wallet]);
  useEffect(() => {
    if (!sentinel.current) return;
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setLimit(l => l + 150); });
    io.observe(sentinel.current); return () => io.disconnect();
  }, [list.length > limit]);

  return html`<div class="screen">
    <div class="topbar"><h1>Movimientos</h1></div>
    <${WalletSwitch} value=${wallet} onChange=${setWallet} allowBoth />
    <div class="row" style="margin-top:10px">
      <input type="search" placeholder="Buscar: tacos, BBVA, 250…" value=${q} onInput=${e => setQ(e.target.value)} />
      <button class="iconbtn flat" onClick=${() => setShowF(true)} aria-label="Filtros" style="position:relative">⚙️
        ${activeCount ? html`<span class="tag" style="position:absolute;top:-6px;right:-6px;padding:1px 6px">${activeCount}</span>` : null}</button>
    </div>
    <div class="row between small muted" style="margin:10px 4px">
      <span style="white-space:nowrap">${list.length.toLocaleString('es-MX')} mov.</span>
      <span class="right">Gastos <b class="exp num">${money(tt.spend)}</b>${tt.income ? html` · Ingresos <b class="inc num">${money(tt.income)}</b>` : ''}</span>
    </div>
    ${activeCount ? html`<button class="chip soft" style="margin-bottom:10px" onClick=${() => setF({ ...EMPTY_F })}>✕ Quitar filtros</button>` : null}
    ${list.length ? html`<${DayGroups} txs=${list} limit=${limit} onOpen=${openTx} showWallet=${wallet === 'both'} />`
      : html`<${Empty} e="🔍">Sin resultados<//>`}
    ${list.length > limit && html`<div ref=${sentinel} class="center muted small" style="padding:20px">Cargando más…</div>`}
    ${showF && html`<${Filters} f=${f} setF=${setF} wallet=${wallet} onClose=${() => setShowF(false)} />`}
  </div>`;
}

function Filters({ f, setF, wallet, onClose }) {
  const S = useStore();
  const [d, setD] = useState(f);
  const ids = walletIdsFor(wallet);
  const cats = ids.flatMap(w => categoriesOf(w, { includeHidden: true })).filter(c => !c.parent_id);
  const uniqueCats = [...new Map(cats.map(c => [c.name, c])).values()];
  const tags = [...new Set([...S.transactions.values()].flatMap(t => t.tags || []))].sort();
  const currencies = [...new Set([...S.transactions.values()].map(t => t.currency))].sort();
  const accounts = [...S.accounts.values()].filter(a => !a.deleted_at);
  const toggle = (k, v) => setD({ ...d, [k]: d[k].includes(v) ? d[k].filter(x => x !== v) : [...d[k], v] });
  // al elegir por nombre, incluir la categoría homónima de ambas carteras
  const catIdsByName = name => cats.filter(c => c.name === name).map(c => c.id);
  return html`<${Sheet} title="Filtros" onClose=${onClose}>
    <div class="sheet-body">
      <div class="grid2">
        <div class="field"><label>Desde</label><input type="date" value=${d.from} onInput=${e => setD({ ...d, from: e.target.value })} /></div>
        <div class="field"><label>Hasta</label><input type="date" value=${d.to} onInput=${e => setD({ ...d, to: e.target.value })} /></div>
      </div>
      <div class="field"><span class="lbl">Tipo</span><div class="chips wrap">${Object.entries(TX_TYPES).map(([k, v]) => html`<button class=${'chip' + (d.types.includes(k) ? ' on' : '')} onClick=${() => toggle('types', k)}>${v.short}</button>`)}</div></div>
      <div class="field"><span class="lbl">Categorías</span><div class="chips wrap">${uniqueCats.map(c => { const idsN = catIdsByName(c.name); const on = idsN.some(i => d.categoryIds.includes(i)); return html`<button class=${'chip' + (on ? ' on' : '')}
        onClick=${() => setD({ ...d, categoryIds: on ? d.categoryIds.filter(x => !idsN.includes(x)) : [...d.categoryIds, ...idsN] })}>${c.icon} ${c.name}</button>`; })}</div></div>
      <div class="field"><span class="lbl">Cuenta</span><div class="chips wrap">${accounts.map(a => html`<button class=${'chip' + (d.accountIds.includes(a.id) ? ' on' : '')} onClick=${() => toggle('accountIds', a.id)}>${a.icon} ${a.name}</button>`)}</div></div>
      <div class="grid2">
        <div class="field"><label>Moneda</label><select value=${d.currency} onChange=${e => setD({ ...d, currency: e.target.value })}><option value="">Todas</option>${currencies.map(c => html`<option value=${c}>${c}</option>`)}</select></div>
        <div class="field"><label>Etiqueta</label><select value=${d.tag} onChange=${e => setD({ ...d, tag: e.target.value })}><option value="">Todas</option>${tags.map(c => html`<option value=${c}>${c}</option>`)}</select></div>
      </div>
      <div class="row"><button class="btn grow" onClick=${() => setD({ ...EMPTY_F })}>Limpiar</button><button class="btn primary grow" onClick=${() => { setF(d); onClose(); }}>Aplicar</button></div>
    </div><//>`;
}
