// Presupuestos, Cuentas, Categorías, Programados, Más y Ajustes
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { useStore, Sheet, CatIcon, Empty, toast, confirmAsk, Seg } from './common.js';
import {
  S as Store, personalWallet, householdWallet, categoriesOf, saveCategory, reorderCategories, mergeCategory, myAccounts, saveAccount,
  budgetsOf, saveBudget, deleteBudget, recurringOf, saveRecurring, deleteRecurring, confirmRecurring, skipRecurring,
  visibleTx, prefs, loadDemoData, syncNow, wipeLocal, walletLabel,
} from '../store.js';
import { filterTx, budgetStatus, accountBalances, totals } from '../logic/stats.js';
import { money, startOfMonth, addMonths, monthName, ymd, daysInMonth, round2, parseAmount } from '../logic/util.js';
import { ICON_CHOICES, COLOR_CHOICES, ACCOUNT_TYPES, CURRENCIES } from '../logic/seed.js';
import { FREQS, dueOccurrences, upcoming } from '../logic/recurring.js';
import { WalletSwitch, useWallet, SyncBadge } from './home.js';
import { remote, auth } from '../cloud.js';

// ================= Presupuestos =================
export function Budgets() {
  const S = useStore();
  const [wallet, setWallet] = useWallet('budWallet');
  const [edit, setEdit] = useState(null);
  const som = startOfMonth(new Date());
  const monthTx = filterTx(visibleTx(), { walletIds: [wallet], from: som, to: addMonths(som, 1) }).map(t => ({ ...t, _parent: S.categories.get(t.category_id)?.parent_id }));
  const list = budgetsOf(wallet).map(b => ({ b, st: budgetStatus(b, monthTx) })).sort((x, y) => y.st.pct - x.st.pct);
  const dayPct = Math.round(new Date().getDate() / daysInMonth(new Date()) * 100);
  const tot = list.reduce((a, x) => ({ amount: a.amount + (x.b.category_id ? x.st.amount : 0), spent: a.spent + (x.b.category_id ? x.st.spent : 0) }), { amount: 0, spent: 0 });
  return html`<div class="screen">
    <div class="topbar"><h1>Presupuestos</h1><button class="iconbtn" onClick=${() => setEdit({ wallet_id: wallet, category_id: null, amount: '' })}>＋</button></div>
    <${WalletSwitch} value=${wallet} onChange=${setWallet} />
    <div class="small muted" style="margin:12px 4px">${monthName(new Date())[0].toUpperCase() + monthName(new Date()).slice(1)} · llevas ${dayPct}% del mes</div>
    ${!list.length ? html`<${Empty} e="🎯">Los presupuestos son opcionales.<br/>Toca <b>＋</b> para poner un tope mensual a una categoría.<//>` : html`
      ${tot.amount > 0 && html`<div class="card"><div class="row between"><b>Total presupuestado</b><span class="num">${money(tot.spent)} / ${money(tot.amount)}</span></div>
        <div class="hbar" style="margin-top:8px;height:10px"><i style=${`width:${Math.min(100, tot.spent / tot.amount * 100)}%;background:var(--accent)`}></i></div></div>`}
      ${list.map(({ b, st }) => { const cat = S.categories.get(b.category_id); const color = st.pct >= 100 ? 'var(--expense)' : st.pct > dayPct + 15 ? 'var(--warn)' : (cat?.color || 'var(--accent)');
        return html`<button class="card" style="width:100%;text-align:left;display:block" onClick=${() => setEdit({ ...b })}>
          <div class="row"><${CatIcon} cat=${cat || { icon: '🎯', color: '#6D5DF6' }} size="sm" />
            <div class="grow"><div class="row between"><b>${cat?.name || 'Total de la cartera'}</b><span class="num small">${st.pct}%</span></div>
            <div class="hbar" style="margin-top:7px;height:10px;position:relative"><i style=${`width:${Math.min(100, st.pct)}%;background:${color}`}></i></div>
            <div class="row between small muted" style="margin-top:6px"><span>Gastado <b class="num" style="color:var(--text)">${money(st.spent)}</b> de ${money(st.amount)}</span>
            <span class=${st.left < 0 ? 'exp' : ''}>${st.left < 0 ? 'Excedido ' + money(-st.left) : 'Disponible ' + money(st.left)}</span></div></div></div>
        </button>`; })}`}
    ${edit && html`<${BudgetForm} b=${edit} onClose=${() => setEdit(null)} />`}
  </div>`;
}

function BudgetForm({ b, onClose }) {
  const [d, setD] = useState({ ...b, amount: b.amount ? String(b.amount) : '' });
  const cats = categoriesOf(d.wallet_id, { kind: 'expense' }).filter(c => !c.parent_id);
  const [err, setErr] = useState('');
  return html`<${Sheet} title=${b.id ? 'Editar presupuesto' : 'Nuevo presupuesto'} onClose=${onClose}>
    <div class="sheet-body">
      <div class="field"><label>Categoría</label><select value=${d.category_id || ''} onChange=${e => setD({ ...d, category_id: e.target.value || null })}>
        <option value="">Total de ${walletLabel(Store.wallets.get(d.wallet_id))}</option>${cats.map(c => html`<option value=${c.id}>${c.icon} ${c.name}</option>`)}</select></div>
      <div class="field"><label>Monto mensual (MXN)</label><input inputmode="decimal" value=${d.amount} placeholder="3000" onInput=${e => setD({ ...d, amount: e.target.value })} /></div>
      ${err && html`<div class="err-box">${err}</div>`}
      <div class="row" style="margin-top:8px">
        ${b.id && html`<button class="btn danger" onClick=${async () => { await deleteBudget(b.id); onClose(); }}>Eliminar</button>`}
        <button class="btn primary grow" onClick=${async () => { try { await saveBudget({ ...d, amount: parseAmount(d.amount) }); onClose(); } catch (e) { setErr(e.message); } }}>Guardar</button>
      </div>
    </div><//>`;
}

// ================= Menú "Más" =================
export function More({ go }) {
  const S = useStore();
  const items = [
    ['cashbox', '💵', 'Caja chica (Hogar)'], ['handovers', '🤝', 'Entregas con doble palomita (Magui)'],
    ['insights', '✨', 'Análisis inteligente'], ['trips', '🧳', 'Viajes y etiquetas'], ['recurring', '🔁', 'Programados (recurrentes)'],
    ['accounts', '💳', 'Cuentas y métodos de pago'], ['categories', '🗂️', 'Categorías'],
  ];
  const data = [['import', '📥', 'Importar historial (Spendee)'], ['export', '📤', 'Exportar y respaldar']];
  const Menu = ({ list }) => html`<div class="menu">${list.map(([k, i, l]) => html`<button onClick=${() => go(k)}><span class="ic">${i}</span><span class="grow">${l}</span><span class="chev">›</span></button>`)}</div>`;
  return html`<div class="screen">
    <div class="topbar"><h1>Más</h1><${SyncBadge} onClick=${() => go('settings')} /></div>
    <${Menu} list=${items} /><${Menu} list=${data} /><${Menu} list=${[['settings', '⚙️', 'Ajustes y cuenta']]} />
    <div class="tiny faint center">Finanzas Hogar · v1.0 ${S.mode === 'local' ? '· modo local' : ''}</div>
  </div>`;
}

// ================= Cuentas =================
export function Accounts({ back }) {
  const S = useStore();
  const [edit, setEdit] = useState(null);
  const bal = accountBalances(visibleTx());
  const list = myAccounts({ includeHidden: true });
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Cuentas</h1><button class="iconbtn" onClick=${() => setEdit({ name: '', type: 'debit', icon: '💳', currency: 'MXN' })}>＋</button></div>
    <div class="small muted" style="margin:0 4px 10px">Una <b>cuenta</b> es con qué pagas (efectivo, BBVA, Amex…). La <b>cartera</b> (Mis gastos / Hogar) es dónde lo registras.</div>
    <div class="list">${list.map(a => html`<button class="tx" onClick=${() => setEdit({ ...a })} style=${a.hidden ? 'opacity:.5' : ''}>
      <div class="caticon" style="background:var(--surface2)">${a.icon}</div>
      <div class="grow"><div class="t1">${a.name}</div><div class="t2">${ACCOUNT_TYPES[a.type]?.label || ''}${a.hidden ? ' · oculta' : ''}</div></div>
      <div class="amt num ${(bal.get(a.id) || 0) < 0 ? 'exp' : ''}" title="Flujo registrado en la app">${money(bal.get(a.id) || 0)}</div></button>`)}</div>
    <div class="tiny faint" style="margin:8px 4px">El monto es el flujo neto registrado en la app (no el saldo real del banco).</div>
    ${edit && html`<${AccountForm} a=${edit} onClose=${() => setEdit(null)} />`}
  </div>`;
}
function AccountForm({ a, onClose }) {
  const [d, setD] = useState(a); const [err, setErr] = useState('');
  return html`<${Sheet} title=${a.id ? 'Editar cuenta' : 'Nueva cuenta'} onClose=${onClose}>
    <div class="sheet-body">
      <div class="field"><label>Nombre</label><input value=${d.name} placeholder="BBVA Débito" onInput=${e => setD({ ...d, name: e.target.value })} /></div>
      <div class="grid2">
        <div class="field"><label>Tipo</label><select value=${d.type} onChange=${e => setD({ ...d, type: e.target.value, icon: ACCOUNT_TYPES[e.target.value].icon })}>${Object.entries(ACCOUNT_TYPES).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</select></div>
        <div class="field"><label>Moneda</label><select value=${d.currency} onChange=${e => setD({ ...d, currency: e.target.value })}>${CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</select></div>
      </div>
      <div class="field"><span class="lbl">Ícono</span><div class="pickgrid">${['💵', '💳', '🏦', '📱', '🪙', '💰', '🟦', '🟥', '🟩', '🟨', '⬛', '🟪'].map(i => html`<button class=${d.icon === i ? 'on' : ''} onClick=${() => setD({ ...d, icon: i })}>${i}</button>`)}</div></div>
      ${a.id && html`<label class="row small" style="margin:10px 0"><input type="checkbox" style="width:auto" checked=${d.hidden} onChange=${e => setD({ ...d, hidden: e.target.checked })} /> Ocultar (no aparece al registrar)</label>`}
      ${err && html`<div class="err-box">${err}</div>`}
      <button class="btn primary block" style="margin-top:8px" onClick=${async () => { try { await saveAccount(d); onClose(); } catch (e) { setErr(e.message); } }}>Guardar</button>
    </div><//>`;
}

// ================= Categorías =================
export function Categories({ back }) {
  const S = useStore();
  const [wallet, setWallet] = useWallet('catWallet');
  const [kind, setKind] = useState('expense');
  const [edit, setEdit] = useState(null);
  const [merge, setMerge] = useState(null);
  const all = categoriesOf(wallet, { includeHidden: true, kind });
  const top = all.filter(c => !c.parent_id);
  const counts = useMemo(() => { const m = new Map(); for (const t of S.transactions.values()) if (!t.deleted_at) m.set(t.category_id, (m.get(t.category_id) || 0) + 1); return m; }, [S.version]);
  const move = async (i, dir) => {
    const ids = top.map(c => c.id); const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; await reorderCategories(ids);
  };
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Categorías</h1>
      <button class="iconbtn" onClick=${() => setEdit({ wallet_id: wallet, name: '', icon: '🏷️', color: '#8B5CF6', kind })}>＋</button></div>
    <${WalletSwitch} value=${wallet} onChange=${setWallet} />
    <div style="margin:10px 0"><${Seg} small value=${kind} onChange=${setKind} options=${[['expense', 'Gastos'], ['income', 'Ingresos']]} /></div>
    <div class="small muted" style="margin:0 4px 10px">⭐ = favorita (sale primero al registrar). ${S.wallets.get(wallet)?.kind === 'household' ? 'Las categorías de Hogar son compartidas.' : ''}</div>
    <div class="list">${top.map((c, i) => html`<div key=${c.id}>
      <div class="tx" style=${c.hidden ? 'opacity:.45' : ''}>
        <div class="col" style="gap:0"><button class="drag" onClick=${() => move(i, -1)} aria-label="Subir">▲</button><button class="drag" onClick=${() => move(i, 1)} aria-label="Bajar">▼</button></div>
        <button class="row grow" style="text-align:left" onClick=${() => setEdit({ ...c })}><${CatIcon} cat=${c} />
          <div class="grow"><div class="t1">${c.name} ${c.favorite ? '⭐' : ''}</div><div class="t2">${counts.get(c.id) || 0} movimientos${c.hidden ? ' · oculta' : ''}</div></div></button>
        <button class="iconbtn flat" title="Favorita" onClick=${() => saveCategory({ ...c, favorite: !c.favorite })}>${c.favorite ? '★' : '☆'}</button>
      </div>
      ${all.filter(s => s.parent_id === c.id).map(s => html`<button class="tx" style="padding-left:64px" onClick=${() => setEdit({ ...s })}>
        <${CatIcon} cat=${s} size="sm" /><div class="grow"><div class="t1 small">${s.name}</div><div class="t2">${counts.get(s.id) || 0} movimientos</div></div></button>`)}
    </div>`)}</div>
    ${edit && html`<${CategoryForm} c=${edit} parents=${top.filter(p => p.id !== edit.id)} onClose=${() => setEdit(null)} onMerge=${() => { setMerge(edit); setEdit(null); }} />`}
    ${merge && html`<${MergeForm} from=${merge} options=${all.filter(c => c.id !== merge.id)} count=${counts.get(merge.id) || 0} onClose=${() => setMerge(null)} />`}
  </div>`;
}
function CategoryForm({ c, parents, onClose, onMerge }) {
  const [d, setD] = useState(c); const [err, setErr] = useState('');
  return html`<${Sheet} title=${c.id ? 'Editar categoría' : 'Nueva categoría'} onClose=${onClose}>
    <div class="sheet-body">
      <div class="row" style="margin-bottom:12px"><${CatIcon} cat=${d} size="lg" /><input class="grow" value=${d.name} placeholder="Nombre" maxlength="60" onInput=${e => setD({ ...d, name: e.target.value })} /></div>
      <div class="field"><span class="lbl">Ícono</span><div class="pickgrid">${ICON_CHOICES.map(i => html`<button class=${d.icon === i ? 'on' : ''} onClick=${() => setD({ ...d, icon: i })}>${i}</button>`)}</div></div>
      <div class="field"><span class="lbl">Color</span><div class="pickgrid">${COLOR_CHOICES.map(col => html`<button class=${d.color === col ? 'on' : ''} onClick=${() => setD({ ...d, color: col })} style="background:none"><span class="swatch" style=${'display:block;background:' + col}></span></button>`)}</div></div>
      <div class="field"><label>Subcategoría de… (opcional)</label><select value=${d.parent_id || ''} onChange=${e => setD({ ...d, parent_id: e.target.value || null })}>
        <option value="">— Es categoría principal —</option>${parents.map(p => html`<option value=${p.id}>${p.icon} ${p.name}</option>`)}</select></div>
      <label class="row small" style="margin:8px 0"><input type="checkbox" style="width:auto" checked=${d.hidden} onChange=${e => setD({ ...d, hidden: e.target.checked })} /> Ocultar (no se borra; el historial se conserva)</label>
      ${err && html`<div class="err-box">${err}</div>`}
      <div class="row" style="margin-top:10px">
        ${c.id && html`<button class="btn" onClick=${onMerge}>Fusionar…</button>`}
        <button class="btn primary grow" onClick=${async () => { try { await saveCategory(d); onClose(); } catch (e) { setErr(e.message); } }}>Guardar</button>
      </div>
    </div><//>`;
}
function MergeForm({ from, options, count, onClose }) {
  const [into, setInto] = useState('');
  return html`<${Sheet} title="Fusionar categoría" onClose=${onClose}>
    <div class="sheet-body">
      <p class="small">Los <b>${count}</b> movimientos de <b>${from.icon} ${from.name}</b> pasarán a la categoría que elijas. ${from.name} quedará oculta. No se pierde ningún movimiento.</p>
      <div class="field"><label>Fusionar dentro de</label><select value=${into} onChange=${e => setInto(e.target.value)}><option value="">Elige…</option>${options.map(o => html`<option value=${o.id}>${o.icon} ${o.name}</option>`)}</select></div>
      <button class="btn primary block" disabled=${!into} onClick=${async () => { const n = await mergeCategory(from.id, into); toast(`${n} movimientos movidos`); onClose(); }}>Fusionar</button>
    </div><//>`;
}

// ================= Programados =================
export function Recurring({ back }) {
  const S = useStore();
  const [edit, setEdit] = useState(null);
  const list = recurringOf();
  const due = list.flatMap(r => dueOccurrences(r).map(d => ({ r, d })));
  const pw = personalWallet();
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Programados</h1>
      <button class="iconbtn" onClick=${() => setEdit({ wallet_id: pw.id, type: 'expense', amount: '', currency: 'MXN', frequency: 'monthly', next_date: ymd(new Date()), description: '', auto_confirm: false, active: true })}>＋</button></div>
    <div class="small muted" style="margin:0 4px 12px">Un pago programado <b>no cuenta como gasto</b> hasta que lo confirmas (o actives "registrar automáticamente").</div>
    ${due.length > 0 && html`<div class="section-title">Por confirmar</div><div class="list">${due.map(({ r, d }) => html`<div class="tx">
      <${CatIcon} cat=${S.categories.get(r.category_id)} />
      <div class="grow"><div class="t1">${r.description || S.categories.get(r.category_id)?.name}</div><div class="t2">${new Date(d + 'T12:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })} · ${walletLabel(S.wallets.get(r.wallet_id))}</div></div>
      <div class="col" style="gap:6px;align-items:flex-end"><b class="num">${money(r.amount, r.currency)}</b>
        <div class="row" style="gap:6px"><button class="chip" onClick=${() => skipRecurring(r)}>Omitir</button>
        <button class="chip on" onClick=${async () => { await confirmRecurring(r, { date: d }); toast('Pago registrado ✓'); }}>Pagado</button></div></div>
    </div>`)}</div>`}
    <div class="section-title">Todos</div>
    ${!list.length ? html`<${Empty} e="🔁">Agrega servicios, colegiaturas, limpieza, suscripciones…<//>` :
      html`<div class="list">${list.map(r => html`<button class="tx" onClick=${() => setEdit({ ...r, amount: String(r.amount) })} style=${r.active ? '' : 'opacity:.5'}>
        <${CatIcon} cat=${S.categories.get(r.category_id)} />
        <div class="grow"><div class="t1">${r.description || S.categories.get(r.category_id)?.name}</div>
          <div class="t2">${FREQS[r.frequency]} · próximo ${upcoming(r, 1)[0] ? new Date(upcoming(r, 1)[0] + 'T12:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'} · ${walletLabel(S.wallets.get(r.wallet_id))}${r.auto_confirm ? ' · automático' : ''}</div></div>
        <div class="amt num">${money(r.amount, r.currency)}</div></button>`)}</div>`}
    ${edit && html`<${RecurringForm} r=${edit} onClose=${() => setEdit(null)} />`}
  </div>`;
}
function RecurringForm({ r, onClose }) {
  const [d, setD] = useState(r); const [err, setErr] = useState('');
  const pw = personalWallet(), hw = householdWallet();
  const cats = categoriesOf(d.wallet_id, { kind: d.type === 'income' ? 'income' : 'expense' });
  return html`<${Sheet} title=${r.id ? 'Editar programado' : 'Nuevo programado'} onClose=${onClose}>
    <div class="sheet-body">
      ${hw && html`<div style="margin-bottom:12px"><${Seg} value=${d.wallet_id} onChange=${w => setD({ ...d, wallet_id: w, category_id: null })} options=${[[pw.id, 'Mis gastos'], [hw.id, 'Hogar']]} /></div>`}
      <div class="field"><label>Descripción</label><input value=${d.description} placeholder="Colegiatura, Netflix, Luz…" onInput=${e => setD({ ...d, description: e.target.value })} /></div>
      <div class="grid2">
        <div class="field"><label>Monto</label><input inputmode="decimal" value=${d.amount} onInput=${e => setD({ ...d, amount: e.target.value })} /></div>
        <div class="field"><label>Moneda</label><select value=${d.currency} onChange=${e => setD({ ...d, currency: e.target.value })}>${CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</select></div>
        <div class="field"><label>Frecuencia</label><select value=${d.frequency} onChange=${e => setD({ ...d, frequency: e.target.value })}>${Object.entries(FREQS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></div>
        <div class="field"><label>Próximo pago</label><input type="date" value=${d.next_date} onInput=${e => setD({ ...d, next_date: e.target.value })} /></div>
        <div class="field"><label>Categoría</label><select value=${d.category_id || ''} onChange=${e => setD({ ...d, category_id: e.target.value || null })}><option value="">Elige…</option>${cats.map(c => html`<option value=${c.id}>${c.icon} ${c.name}</option>`)}</select></div>
        <div class="field"><label>Cuenta</label><select value=${d.account_id || ''} onChange=${e => setD({ ...d, account_id: e.target.value || null })}><option value="">—</option>${myAccounts().map(a => html`<option value=${a.id}>${a.icon} ${a.name}</option>`)}</select></div>
        <div class="field"><label>Termina (opcional)</label><input type="date" value=${d.end_date || ''} onInput=${e => setD({ ...d, end_date: e.target.value || null })} /></div>
      </div>
      <label class="row small" style="margin:6px 0"><input type="checkbox" style="width:auto" checked=${d.auto_confirm} onChange=${e => setD({ ...d, auto_confirm: e.target.checked })} /> Registrar automáticamente como pagado (solo MXN)</label>
      <label class="row small" style="margin:6px 0"><input type="checkbox" style="width:auto" checked=${d.active} onChange=${e => setD({ ...d, active: e.target.checked })} /> Activo</label>
      ${err && html`<div class="err-box">${err}</div>`}
      <div class="row" style="margin-top:10px">
        ${r.id && html`<button class="btn danger" onClick=${async () => { if (confirmAsk('¿Eliminar este programado? Los pagos ya registrados se conservan.')) { await deleteRecurring(r.id); onClose(); } }}>Eliminar</button>`}
        <button class="btn primary grow" onClick=${async () => { try { if (!d.category_id) throw new Error('Elige una categoría'); await saveRecurring({ ...d, amount: parseAmount(d.amount) }); onClose(); } catch (e) { setErr(e.message); } }}>Guardar</button>
      </div>
    </div><//>`;
}

// ================= Ajustes =================
export function Settings({ back, onSignOut }) {
  const S = useStore();
  const [theme, setTheme] = useState(prefs.get('theme', 'auto'));
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [pass, setPass] = useState('');
  const hw = householdWallet();
  const applyTheme = t => { setTheme(t); prefs.set('theme', t); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); };
  const people = Object.values(S.people);
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Ajustes</h1></div>
    <div class="card"><h3>Apariencia</h3><${Seg} value=${theme} onChange=${applyTheme} options=${[['auto', 'Automático'], ['dark', 'Oscuro'], ['light', 'Claro']]} /></div>

    ${S.mode === 'cloud' ? html`
      <div class="card"><h3>Sincronización</h3>
        <div class="small">${!S.sync.online ? '📴 Sin conexión. Todo lo que registres se guarda en el teléfono y se sube solo al volver el internet.' : S.sync.pending ? `⏳ ${S.sync.pending} cambio(s) por subir` : '✅ Todo sincronizado'}</div>
        ${S.sync.last && html`<div class="tiny muted" style="margin-top:4px">Última sincronización: ${S.sync.last.toLocaleString('es-MX')}</div>`}
        ${S.sync.error && html`<div class="err-box" style="margin-top:8px">${S.sync.error}</div>`}
        <button class="btn block" style="margin-top:10px" disabled=${S.sync.busy} onClick=${() => syncNow()}>${S.sync.busy ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
      </div>
      <div class="card"><h3>Hogar</h3>
        ${hw ? html`<div class="small">Integrantes: <b>${people.map(p => p.id === S.user.id ? 'Tú' : p.display_name).join(', ')}</b></div>
          ${hw.invite_code && hw.owner_id === S.user.id && html`<div class="small" style="margin-top:8px">Código para invitar a Andrés: <b style="font-size:18px;letter-spacing:2px">${hw.invite_code}</b></div>`}`
        : html`<div class="small" style="margin-bottom:10px">Aún no estás en un Hogar.</div>
          <button class="btn primary block" onClick=${async () => { try { await remote.createHousehold(); await syncNow(); setMsg('Hogar creado ✓'); } catch (e) { setMsg(e.message); } }}>Crear Hogar</button>
          <div class="row" style="margin-top:10px"><input placeholder="Código de invitación" value=${code} onInput=${e => setCode(e.target.value)} /><button class="btn" onClick=${async () => { try { await remote.joinHousehold(code); await syncNow(); setMsg('Te uniste al Hogar ✓'); } catch (e) { setMsg(e.message); } }}>Unirme</button></div>`}
        ${msg && html`<div class="small" style="margin-top:8px">${msg}</div>`}
      </div>
      <div class="card"><h3>Mi cuenta</h3>
        <div class="small muted">${S.user.email}</div>
        <div class="row" style="margin-top:10px"><input type="password" placeholder="Nueva contraseña (mín. 8)" value=${pass} onInput=${e => setPass(e.target.value)} autocomplete="new-password" />
          <button class="btn" disabled=${pass.length < 8} onClick=${async () => { try { await auth.updatePassword(pass); setPass(''); toast('Contraseña actualizada'); } catch (e) { toast(e.message); } }}>Cambiar</button></div>
        <button class="btn danger block" style="margin-top:12px" onClick=${onSignOut}>Cerrar sesión</button>
      </div>`
    : html`<div class="card"><h3>Modo local 📱</h3>
        <div class="small">La app está funcionando <b>solo en este dispositivo</b> (sin nube). Para usarla con Andrés y en varios dispositivos hay que conectar Supabase — ver <b>LEEME.md</b>, paso 1.</div>
        <div class="row" style="margin-top:12px">
          <button class="btn grow" onClick=${async () => { const n = await loadDemoData(); toast(`${n} movimientos de ejemplo cargados`); }}>Cargar datos de ejemplo</button>
        </div>
        <button class="btn danger block" style="margin-top:10px" onClick=${async () => { if (confirmAsk('Esto borra TODOS los datos de este dispositivo. ¿Ya exportaste un respaldo?') && confirmAsk('¿Seguro? No se puede deshacer.')) { await wipeLocal(); location.reload(); } }}>Borrar datos de este dispositivo</button>
      </div>`}
    <div class="card"><h3>Instalar en iPhone</h3><div class="small">Abre la app en <b>Safari</b> → botón <b>Compartir</b> (□↑) → <b>Agregar a pantalla de inicio</b>. Se abrirá como app, sin barra de Safari.</div></div>
  </div>`;
}
