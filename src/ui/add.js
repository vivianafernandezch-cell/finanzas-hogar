// ⚡ Registro ultrarrápido: cantidad → categoría → Guardar.
import { html, useState, useEffect, useMemo, useRef } from '../../vendor/preact-htm.js';
import { Sheet, CatIcon, Seg, toast, confirmAsk } from './common.js';
import {
  S, personalWallet, householdWallet, newTxDraft, saveTx, deleteTx, restoreTx, duplicateTx, categoryRanking,
  categoriesOf, myAccounts, prefs, upsert, boxAccount,
} from '../store.js';
import { money, round2, pad } from '../logic/util.js';
import { TX_TYPES, CURRENCIES } from '../logic/seed.js';
import { suggestRate, rememberRate } from '../logic/fx.js';
import { remote } from '../cloud.js';

const toLocalInput = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Evalúa "120+35.5" de forma segura (solo sumas y restas)
export function evalExpr(s) {
  if (!s) return 0;
  const parts = s.match(/[+-]?[^+-]+/g) || [];
  let t = 0; for (const p of parts) { const n = parseFloat(p); if (!isNaN(n)) t += n; }
  return round2(t);
}

export function AddSheet({ editing, draft, presetWallet, presetAccount, onClose, onSaved }) {
  const isEdit = !!editing;
  const initialWallet = editing?.wallet_id || presetWallet || prefs.get('lastWallet') || personalWallet()?.id;
  const [t, setT] = useState(() => editing ? { ...editing } : draft ? { ...draft } : { ...newTxDraft(S.wallets.has(initialWallet) ? initialWallet : personalWallet()?.id), ...(presetAccount ? { account_id: presetAccount } : {}) });
  const [expr, setExpr] = useState(() => editing || draft ? String(+(editing || draft).amount) : '');
  const [allCats, setAllCats] = useState(false);
  const [more, setMore] = useState(isEdit && (editing.currency !== 'MXN' || editing.tags?.length || editing.note));
  const [fxSource, setFxSource] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const descRef = useRef();

  const pw = personalWallet(), hw = householdWallet();
  const set = patch => { setErr(''); setT(prev => ({ ...prev, ...patch })); };
  const amount = evalExpr(expr);
  const isMove = t.type === 'transfer' || t.type === 'card_payment';
  const catKind = t.type === 'income' ? 'income' : 'expense';
  const ranked = useMemo(() => categoryRanking(t.wallet_id, catKind), [t.wallet_id, catKind, S.version]);
  const visibleCats = allCats || ranked.length <= 8 ? ranked : ranked.slice(0, 7);
  const subs = t.category_id ? categoriesOf(t.wallet_id).filter(c => c.parent_id === (S.categories.get(t.category_id)?.parent_id || t.category_id)) : [];
  const accounts = myAccounts();
  const accountsForWallet = isEdit && t.created_by !== S.user.id ? [...S.accounts.values()] : accounts;

  // Cambiar de cartera: las categorías son por cartera → buscar la equivalente por nombre
  function switchWallet(w) {
    if (w === t.wallet_id) return;
    const old = S.categories.get(t.category_id);
    const eq = old ? categoriesOf(w).find(c => c.name === old.name) : null;
    set({ wallet_id: w, category_id: eq?.id || null, account_id: t.account_id || prefs.get('lastAccount:' + w, null) });
  }

  // Moneda extranjera → tipo de cambio sugerido (editable)
  useEffect(() => {
    if (t.currency === 'MXN') { if (t.fx_rate !== 1) set({ fx_rate: 1 }); setFxSource(''); return; }
    if (isEdit && editing.currency === t.currency) { setFxSource('guardado en el movimiento'); return; }
    let alive = true;
    suggestRate(t.currency, t.occurred_at.slice(0, 10)).then(r => { if (alive) { if (r.rate) set({ fx_rate: round2(r.rate * 10000) / 10000 }); setFxSource(r.source); } });
    return () => { alive = false; };
  }, [t.currency]);

  // Teclado físico (Mac)
  useEffect(() => {
    const onKey = e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) { if (e.key === 'Enter' && tag === 'input' && e.target.type !== 'file') { e.preventDefault(); save(); } return; }
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === '+' || e.key === '-') press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') { e.preventDefault(); save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function press(k) {
    setErr('');
    setExpr(prev => {
      if (k === '⌫') return prev.slice(0, -1);
      if (k === '+' || k === '-') return !prev || /[+-]$/.test(prev) ? prev : prev + k;
      const seg = prev.split(/[+-]/).pop();
      if (k === '.') return seg.includes('.') ? prev : prev + (seg === '' ? '0.' : '.');
      if (k === '00') return seg === '' || seg === '0' ? prev : prev + '00';
      if (/\.\d{2}$/.test(seg)) return prev;              // máx 2 decimales
      if (seg === '0') return prev.slice(0, -1) + k;
      if (prev.replace(/\D/g, '').length >= 10) return prev;
      return prev + k;
    });
  }

  async function save(another = false) {
    if (busy) return;
    const row = { ...t, amount, occurred_at: t.occurred_at };
    if (!(amount > 0)) { setErr('Escribe la cantidad'); return; }
    if (!isMove && !row.category_id) { setErr('Elige una categoría'); return; }
    setBusy(true);
    try {
      const before = isEdit ? { ...editing } : null;
      const saved = await saveTx(row);
      rememberRate(saved.currency, saved.fx_rate);
      onSaved?.(saved);
      const cat = S.categories.get(saved.category_id);
      const label = `${cat ? cat.icon + ' ' : ''}${money(saved.amount, saved.currency)} ${isEdit ? 'actualizado' : 'guardado'}`;
      const undo = { label: 'Deshacer', fn: async () => { if (before) await upsert('transactions', [before]); else await deleteTx(saved.id); toast('Listo, se deshizo'); } };
      if (another) {
        setT({ ...newTxDraft(saved.wallet_id), currency: saved.currency, fx_rate: saved.fx_rate, tags: saved.tags, account_id: saved.account_id });
        setExpr(''); setBusy(false); toast(label, [undo], 3500);
        return;
      }
      toast(label, [undo, ...(isEdit ? [] : [{ label: '+ Otro', fn: () => window.dispatchEvent(new CustomEvent('fh:add', { detail: { wallet: saved.wallet_id } })) }])]);
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function onDelete() {
    if (!confirmAsk('¿Eliminar este movimiento?')) return;
    await deleteTx(t.id); onClose();
    toast('Movimiento eliminado', [{ label: 'Deshacer', fn: () => restoreTx(t.id) }]);
  }

  async function onPhoto(e) {
    const f = e.target.files?.[0]; if (!f) return;
    try { set({ _receipt_local: await compressImage(f), receipt_path: null }); } catch { setErr('No se pudo leer la foto'); }
  }

  const tagStr = (t.tags || []).join(', ');
  const knownTags = useMemo(() => { const s = new Set(); for (const x of S.transactions.values()) (x.tags || []).forEach(g => s.add(g)); return [...s].sort(); }, [S.version]);
  const recentDescs = useMemo(() => {
    const m = new Map();
    for (const x of S.transactions.values()) if (x.description && x.category_id === t.category_id && !x.deleted_at) m.set(x.description, (m.get(x.description) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(e => e[0]);
  }, [t.category_id]);
  const people = hw ? Object.values(S.people) : [];

  return html`<${Sheet} title=${isEdit ? 'Editar movimiento' : 'Nuevo movimiento'} onClose=${onClose} full
    right=${isEdit ? html`<button class="iconbtn flat" title="Duplicar" onClick=${() => { const d = duplicateTx(t); onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('fh:edit', { detail: { tx: d, isNew: true } })), 50); }}>⧉</button>
      <button class="iconbtn flat" title="Eliminar" onClick=${onDelete}>🗑️</button>` : null}>
    <div class="sheet-body add" style="padding-bottom:0">
      ${hw && html`<${Seg} value=${t.wallet_id} onChange=${switchWallet} options=${[[pw.id, 'Mis gastos'], [hw.id, 'Hogar']]} />`}
      <div class="chips" style="margin-top:10px">
        ${['expense', 'income', 'transfer', 'card_payment', 'refund'].map(k => html`<button class=${'chip' + (t.type === k ? ' on' : '')}
          onClick=${() => set({ type: k, category_id: (k === 'income') !== (t.type === 'income') ? null : t.category_id })}>${TX_TYPES[k].short}</button>`)}
      </div>

      <div class="amount" onClick=${() => setMore(true)}>
        <span class=${'val' + (amount ? '' : ' zero')}>${amount ? (t.currency === 'MXN' ? '$' : '') + amount.toLocaleString('es-MX', { maximumFractionDigits: 2 }) : '0'}</span>
        <span class="cur">${t.currency}</span>
      </div>
      <div class="expr">${/[+-]/.test(expr) ? expr.replace(/([+-])/g, ' $1 ') + ' =' : ''}</div>
      ${t.currency !== 'MXN' && html`<div class="fxbox">
        <span>1 ${t.currency} =</span>
        <input type="number" inputmode="decimal" step="0.0001" value=${t.fx_rate} onInput=${e => set({ fx_rate: parseFloat(e.target.value) || 0 })} aria-label="Tipo de cambio" />
        <span>MXN · ≈ <b>${money(round2(amount * (t.fx_rate || 0)))}</b></span>
      </div>
      <div class="center tiny faint" style="margin-top:2px">${fxSource}</div>`}

      ${!isMove ? html`
        <div class="catgrid" style="margin-top:10px">
          ${visibleCats.map(c => html`<button class=${'catbtn' + (t.category_id === c.id || S.categories.get(t.category_id)?.parent_id === c.id ? ' on' : '')}
            onClick=${() => { set({ category_id: c.id }); }}>
            <${CatIcon} cat=${c} /><span class="nm">${c.name}</span></button>`)}
          ${ranked.length > 8 && html`<button class="catbtn" onClick=${() => setAllCats(!allCats)}>
            <div class="caticon" style="background:var(--surface2)">${allCats ? '▴' : '⋯'}</div><span class="nm">${allCats ? 'Menos' : 'Todas'}</span></button>`}
        </div>
        ${subs.length > 0 && html`<div class="chips" style="margin-top:6px">
          ${subs.map(c => html`<button class=${'chip' + (t.category_id === c.id ? ' on' : '')} onClick=${() => set({ category_id: t.category_id === c.id ? c.parent_id : c.id })}>${c.icon} ${c.name}</button>`)}
        </div>`}`
      : html`<div class="grid2" style="margin-top:10px">
          <div class="field"><label>Desde</label>${accountSelect(accounts, t.account_id, v => set({ account_id: v }))}</div>
          <div class="field"><label>${t.type === 'card_payment' ? 'Tarjeta que pagas' : 'Hacia'}</label>${accountSelect(accounts.filter(a => t.type !== 'card_payment' || a.type === 'credit'), t.to_account_id, v => set({ to_account_id: v }))}</div>
          <div class="tiny muted" style="grid-column:span 2">No cuenta como gasto ni ingreso (evita contar doble).</div>
        </div>`}

      ${!isMove && boxAccount() && t.wallet_id === hw?.id && html`<div class="chips" style="margin-top:8px">
        <button class=${'chip' + (t.account_id === boxAccount().id ? ' on' : '')} onClick=${() => set({ account_id: t.account_id === boxAccount().id ? prefs.get('lastAccount:' + t.wallet_id, null) : boxAccount().id })}>💵 Pagado con caja chica</button>
      </div>`}
      <div class="descrow" style="margin-top:10px">
        <input ref=${descRef} placeholder="Descripción (opcional)" value=${t.description} maxlength="200" list="desc-sug"
          onInput=${e => set({ description: e.target.value })} enterkeyhint="done" />
        <datalist id="desc-sug">${recentDescs.map(d => html`<option value=${d} />`)}</datalist>
        <button class="toggle-more" onClick=${() => setMore(!more)}>${more ? 'Menos ▴' : 'Detalles ▾'}</button>
      </div>

      ${more && html`<div style="margin-top:12px">
        <div class="grid2">
          <div class="field"><label>Fecha y hora</label>
            <input type="datetime-local" value=${toLocalInput(t.occurred_at)} onInput=${e => { const d = new Date(e.target.value); if (!isNaN(d)) set({ occurred_at: d.toISOString() }); }} /></div>
          <div class="field"><label>Moneda</label>
            <select value=${t.currency} onChange=${e => set({ currency: e.target.value })}>${CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</select></div>
          ${!isMove && html`<div class="field"><label>Cuenta / método de pago</label>${accountSelect(accountsForWallet, t.account_id, v => set({ account_id: v }))}</div>`}
          ${t.wallet_id === hw?.id && people.length > 1 && html`<div class="field"><label>¿Quién pagó?</label>
            <select value=${t.paid_by || S.user.id} onChange=${e => set({ paid_by: e.target.value })}>
              ${people.map(p => html`<option value=${p.id}>${p.id === S.user.id ? 'Yo' : p.display_name}</option>`)}</select></div>`}
        </div>
        <div class="field"><label>Etiquetas (separadas por coma) · ej. Madrid 2026</label>
          <input value=${tagStr} list="tag-sug" placeholder="Viaje, evento…" onChange=${e => set({ tags: [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))] })} />
          <datalist id="tag-sug">${knownTags.map(g => html`<option value=${g} />`)}</datalist>
          ${knownTags.length > 0 && html`<div class="chips">${knownTags.slice(-8).reverse().map(g => html`<button class=${'chip' + (t.tags?.includes(g) ? ' on' : '')}
            onClick=${() => set({ tags: t.tags?.includes(g) ? t.tags.filter(x => x !== g) : [...(t.tags || []), g] })}>#${g}</button>`)}</div>`}
        </div>
        <div class="field"><label>Notas</label><textarea value=${t.note} maxlength="2000" onInput=${e => set({ note: e.target.value })}></textarea></div>
        <div class="field"><label>Foto del ticket</label>
          <input type="file" accept="image/*" capture="environment" onChange=${onPhoto} />
          <${Receipt} t=${t} />
        </div>
        ${isEdit && html`<div class="tiny faint">Registrado por ${t.created_by === S.user.id ? 'ti' : (S.people[t.created_by]?.display_name || 'otra persona')}${t.import_batch_id ? ' · importado' : ''}</div>`}
      </div>`}
      ${err && html`<div class="err-box" style="margin-top:10px">${err}</div>`}
    </div>
    <div class="keypad">
      ${['1', '2', '3', '⌫', '4', '5', '6', '+', '7', '8', '9'].map(k => html`<button class=${k === '⌫' || k === '+' ? 'op' : ''} onClick=${() => press(k)} aria-label=${k === '⌫' ? 'Borrar' : k}>${k}</button>`)}
      <button class="save" disabled=${busy} onClick=${() => save(false)}>${isEdit ? 'Guardar' : 'Guardar'}</button>
      <button onClick=${() => press('.')}>.</button>
      <button onClick=${() => press('0')}>0</button>
      ${isEdit ? html`<button onClick=${() => press('00')}>00</button>` : html`<button class="op" style="font-size:13px;font-weight:700" onClick=${() => save(true)} title="Guardar y registrar otro">＋otro</button>`}
    </div>
  <//>`;
}

function accountSelect(list, value, onChange) {
  return html`<select value=${value || ''} onChange=${e => onChange(e.target.value || null)}>
    <option value="">— Sin cuenta —</option>
    ${list.map(a => html`<option value=${a.id}>${a.icon} ${a.name}</option>`)}
  </select>`;
}

function Receipt({ t }) {
  const [url, setUrl] = useState(t._receipt_local || null);
  useEffect(() => {
    if (t._receipt_local) { setUrl(t._receipt_local); return; }
    if (t.receipt_path && S.mode === 'cloud') remote.receiptUrl(t.receipt_path).then(setUrl).catch(() => setUrl(null));
  }, [t._receipt_local, t.receipt_path]);
  return url ? html`<img class="receipt" src=${url} alt="Ticket" />` : null;
}

export function compressImage(file, max = 1400, q = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image(); const u = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = rej; img.src = u;
  });
}
