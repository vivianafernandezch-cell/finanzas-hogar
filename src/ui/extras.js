// 💵 Caja chica  ·  ✅✅ Entregas con doble palomita (Magui)
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useStore, Sheet, CatIcon, Empty, toast, confirmAsk } from './common.js';
import {
  S as Store, householdWallet, boxAccount, createBox, boxMovements, addBoxDeposit, deleteTx, restoreTx,
  handoverRules, handoversList, saveHandoverRule, refreshHandovers, confirmHandover, editHandover, addHandover, deleteHandover, handoverStatus,
} from '../store.js';
import { money, ymd, parseAmount, addDays } from '../logic/util.js';

const fmtDay = d => new Date(d + (d.length === 10 ? 'T12:00' : '')).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
const personName = id => id === Store.user.id ? 'Tú' : (Store.people[id]?.display_name || 'Tu pareja');
const giverName = h => h.given_by ? personName(h.given_by) : (Object.values(Store.people).find(p => p.id !== h.payee_id)?.display_name || 'quien entrega');

// ================= Caja chica =================
export function CashBox({ back, openTx }) {
  const S = useStore();
  const [dep, setDep] = useState(false);
  const box = boxAccount();
  const hw = householdWallet();
  if (!hw) return html`<div class="screen"><div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Caja chica</h1></div><${Empty} e="🏠">Primero crea o únete a Hogar.<//></div>`;
  if (!box) return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Caja chica</h1></div>
    <div class="card center"><div style="font-size:44px">💵</div><h3>Lleva el efectivo de la casa</h3>
      <div class="small muted" style="margin-bottom:14px">Anota cuando Andrés te da efectivo (no cuenta como gasto) y paga tortillas, agua, etc. "con caja chica": cuentan como gasto de Hogar y se descuentan del saldo.</div>
      <button class="btn primary block" onClick=${() => createBox()}>Crear caja chica</button></div>
  </div>`;
  const { balance, items } = boxMovements();
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Caja chica</h1></div>
    <div class="card hero center">
      <div class="muted small" style="font-weight:600">Te queda en efectivo</div>
      <div class=${'big num ' + (balance < 0 ? 'exp' : '')}>${money(balance)}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn primary grow" onClick=${() => setDep(true)}>＋ Me dieron efectivo</button>
        <button class="btn grow" onClick=${() => window.dispatchEvent(new CustomEvent('fh:add', { detail: { wallet: hw.id, account: box.id } }))}>− Gasté</button>
      </div>
      <div class="tiny muted" style="margin-top:8px">"Gasté" abre el registro normal con <b>Caja chica</b> ya elegida.</div>
    </div>
    ${!items.length ? html`<${Empty} e="🪙">Aún no hay movimientos en la caja.<//>` : html`
      <div class="list">${items.map(({ t, delta, balance: b }) => { const cat = S.categories.get(t.category_id); const isIn = delta > 0;
        return html`<button class="tx" onClick=${() => isIn ? onDeposit(t) : openTx(t)}>
          <${CatIcon} cat=${isIn ? { icon: '💵', color: '#12A46B' } : cat} />
          <div class="grow"><div class="t1 ellipsis">${isIn ? (t.description || 'Efectivo recibido') : (t.description || cat?.name || 'Gasto')}</div>
            <div class="t2">${fmtDay(t.occurred_at.slice(0, 10))}${!isIn && cat ? ' · ' + cat.name : ''}</div></div>
          <div class="amt"><span class=${isIn ? 'inc' : ''}>${isIn ? '+' : '−'}${money(Math.abs(delta))}</span><span class="orig">queda ${money(b)}</span></div>
        </button>`; })}</div>`}
    ${dep && html`<${DepositForm} onClose=${() => setDep(false)} />`}
  </div>`;
}
async function onDeposit(t) {
  if (confirmAsk(`¿Eliminar esta entrada de ${money(t.amount_mxn)} a la caja?`)) {
    await deleteTx(t.id);
    toast('Entrada eliminada', [{ label: 'Deshacer', fn: () => restoreTx(t.id) }]);
  }
}
function DepositForm({ onClose }) {
  const people = Object.values(Store.people).filter(p => p.id !== Store.user.id);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(ymd(new Date()));
  const [note, setNote] = useState(people[0] ? `${people[0].display_name} me dio efectivo` : 'Efectivo para la caja');
  const [err, setErr] = useState('');
  return html`<${Sheet} title="Entró efectivo a la caja" onClose=${onClose}>
    <div class="sheet-body">
      <div class="field"><label>¿Cuánto?</label><input inputmode="decimal" placeholder="500" value=${amount} onInput=${e => setAmount(e.target.value)} autofocus /></div>
      <div class="grid2">
        <div class="field"><label>Fecha</label><input type="date" value=${date} onInput=${e => setDate(e.target.value)} /></div>
        <div class="field"><label>Nota</label><input value=${note} onInput=${e => setNote(e.target.value)} /></div>
      </div>
      <div class="tiny muted" style="margin-bottom:10px">No cuenta como gasto ni ingreso; solo sube el saldo de la caja.</div>
      ${err && html`<div class="err-box" style="margin-bottom:10px">${err}</div>`}
      <button class="btn primary block" onClick=${async () => { try { await addBoxDeposit({ amount: parseAmount(amount), date, note }); toast(`+${money(parseAmount(amount))} a la caja`); onClose(); } catch (e) { setErr(e.message); } }}>Guardar</button>
    </div><//>`;
}

// ================= Entregas con doble palomita =================
export function Handovers({ back }) {
  const S = useStore();
  const [edit, setEdit] = useState(null);
  const [ruleForm, setRuleForm] = useState(null);
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(null);
  const hw = householdWallet();
  useEffect(() => { refreshHandovers(); }, []);
  if (!hw) return html`<div class="screen"><div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Entregas</h1></div><${Empty} e="🏠">Primero crea o únete a Hogar.<//></div>`;
  const rules = handoverRules();
  const list = handoversList();
  const pending = list.filter(h => handoverStatus(h) !== 'ok');
  const toggle = async (h, side) => {
    const isPayee = h.payee_id === S.user.id;
    if (S.mode === 'cloud' && ((side === 'received' && !isPayee) || (side === 'given' && isPayee))) {
      toast(side === 'received' ? `Esta palomita la marca ${personName(h.payee_id)}` : 'Esta palomita la marca quien entrega el dinero'); return;
    }
    const done = !(side === 'given' ? h.given_at : h.received_at);
    if (!done && !confirmAsk('¿Quitar tu palomita?')) return;
    setBusy(h.id + side);
    try { await confirmHandover(h, side, done); } catch (e) { toast(e.message); } finally { setBusy(null); }
  };
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Entregas ✅✅</h1>
      <button class="iconbtn" title="Entrega suelta" onClick=${() => setExtra(true)}>＋</button></div>
    <div class="small muted" style="margin:0 4px 12px">Quien entrega marca <b>"Ya lo di"</b> y quien recibe marca <b>"Ya lo recibí"</b>. Verde = los dos confirmaron.</div>
    ${!rules.length && html`<div class="card"><h3>Configura la entrega semanal</h3>
      <div class="small muted" style="margin-bottom:10px">Ej.: Magui, $1,000 cada semana. Cada semana aparece sola una fila para confirmar.</div>
      <button class="btn primary block" onClick=${() => setRuleForm({ concept: 'Magui', amount: '1000', start_date: lastMonday(), frequency: 'weekly' })}>Configurar</button></div>`}
    ${pending.length > 0 && html`<div class="banner">⏳ <span class="grow"><b>${pending.length}</b> por confirmar · ${money(pending.reduce((a, h) => a + +h.amount, 0))}</span></div>`}
    ${list.length ? html`<div class="list">${list.map(h => { const st = handoverStatus(h);
      return html`<div class="tx" style="align-items:flex-start">
        <div class="caticon" style=${`background:${st === 'ok' ? 'rgba(18,164,107,.18)' : st === 'half' ? 'rgba(217,119,6,.18)' : 'var(--surface2)'}`}>${st === 'ok' ? '✅' : st === 'half' ? '⏳' : '🤝'}</div>
        <button class="grow" style="text-align:left" onClick=${() => setEdit(h)}>
          <div class="t1">${h.concept} · ${money(h.amount)}</div>
          <div class="t2">${h.rule_id ? 'Semana del ' : ''}${fmtDay(h.period_date)}${h.note ? ' · ' + h.note : ''}</div>
          <div class="row wrap" style="gap:6px;margin-top:8px">
            <span class=${'chip' + (h.given_at ? ' on' : '')} role="button" style=${busy === h.id + 'given' ? 'opacity:.5' : ''} onClick=${e => { e.stopPropagation(); toggle(h, 'given'); }}>${h.given_at ? '✓' : '○'} Ya lo di · ${h.payee_id === Store.user.id || h.given_by ? giverName(h) : 'Tú'}</span>
            <span class=${'chip' + (h.received_at ? ' on' : '')} role="button" style=${busy === h.id + 'received' ? 'opacity:.5' : ''} onClick=${e => { e.stopPropagation(); toggle(h, 'received'); }}>${h.received_at ? '✓' : '○'} Ya lo recibí · ${personName(h.payee_id)}</span>
          </div>
        </button>
      </div>`; })}</div>` : rules.length ? html`<${Empty} e="🤝">Aún no hay semanas. La primera aparece en su fecha.<//>` : null}
    ${rules.length > 0 && html`<div class="section-title">Entregas automáticas</div><div class="list">${rules.map(r => html`<button class="tx" onClick=${() => setRuleForm({ ...r, amount: String(r.amount) })} style=${r.active ? '' : 'opacity:.5'}>
      <div class="caticon" style="background:var(--surface2)">🔁</div>
      <div class="grow"><div class="t1">${r.concept}</div><div class="t2">${{ weekly: 'Cada semana', biweekly: 'Cada 2 semanas', monthly: 'Cada mes' }[r.frequency]} · desde ${fmtDay(r.start_date)} · recibe ${personName(r.payee_id)}</div></div>
      <div class="amt num">${money(r.amount)}</div></button>`)}</div>`}
    ${edit && html`<${EditHandover} h=${edit} onClose=${() => setEdit(null)} />`}
    ${ruleForm && html`<${RuleForm} r=${ruleForm} onClose=${() => setRuleForm(null)} />`}
    ${extra && html`<${ExtraForm} onClose=${() => setExtra(false)} />`}
  </div>`;
}
function lastMonday() { const d = new Date(); return ymd(addDays(d, -((d.getDay() + 6) % 7))); }

function RuleForm({ r, onClose }) {
  const [d, setD] = useState(r); const [err, setErr] = useState('');
  const members = Object.values(Store.people);
  return html`<${Sheet} title=${r.id ? 'Editar entrega automática' : 'Entrega automática'} onClose=${onClose}>
    <div class="sheet-body">
      <div class="grid2">
        <div class="field"><label>Concepto</label><input value=${d.concept} onInput=${e => setD({ ...d, concept: e.target.value })} /></div>
        <div class="field"><label>Monto</label><input inputmode="decimal" value=${d.amount} onInput=${e => setD({ ...d, amount: e.target.value })} /></div>
        <div class="field"><label>Frecuencia</label><select value=${d.frequency} onChange=${e => setD({ ...d, frequency: e.target.value })}>
          <option value="weekly">Cada semana</option><option value="biweekly">Cada 2 semanas</option><option value="monthly">Cada mes</option></select></div>
        <div class="field"><label>Primera fecha</label><input type="date" value=${d.start_date} onInput=${e => setD({ ...d, start_date: e.target.value })} /></div>
      </div>
      <div class="field"><label>¿Quién recibe el dinero?</label><select value=${d.payee_id || Store.user.id} onChange=${e => setD({ ...d, payee_id: e.target.value })}>
        ${members.map(p => html`<option value=${p.id}>${p.id === Store.user.id ? 'Yo' : p.display_name}</option>`)}</select></div>
      ${r.id && html`<label class="row small" style="margin:6px 0"><input type="checkbox" style="width:auto" checked=${d.active} onChange=${e => setD({ ...d, active: e.target.checked })} /> Activa (genera semanas nuevas)</label>`}
      <div class="tiny muted" style="margin-bottom:10px">Cambiar el monto aquí aplica a las semanas nuevas. Para una semana con horas extra, toca esa semana.</div>
      ${err && html`<div class="err-box" style="margin-bottom:10px">${err}</div>`}
      <button class="btn primary block" onClick=${async () => { try { await saveHandoverRule({ ...d, amount: parseAmount(d.amount) }); onClose(); } catch (e) { setErr(e.message); } }}>Guardar</button>
    </div><//>`;
}
function EditHandover({ h, onClose }) {
  const [amount, setAmount] = useState(String(+h.amount)); const [note, setNote] = useState(h.note || ''); const [err, setErr] = useState('');
  return html`<${Sheet} title=${`${h.concept} · ${fmtDay(h.period_date)}`} onClose=${onClose}>
    <div class="sheet-body">
      <div class="grid2">
        <div class="field"><label>Monto</label><input inputmode="decimal" value=${amount} onInput=${e => setAmount(e.target.value)} /></div>
        <div class="field"><label>Nota</label><input placeholder="Horas extra…" value=${note} onInput=${e => setNote(e.target.value)} /></div>
      </div>
      <div class="tiny muted" style="margin-bottom:10px">Si cambias el monto, las palomitas se reinician para que ambos confirmen el nuevo.</div>
      ${err && html`<div class="err-box" style="margin-bottom:10px">${err}</div>`}
      <div class="row">
        <button class="btn danger" onClick=${async () => { if (confirmAsk('¿Eliminar esta entrega?')) { try { await deleteHandover(h); onClose(); } catch (e) { setErr(e.message); } } }}>Eliminar</button>
        <button class="btn primary grow" onClick=${async () => { try { await editHandover(h, parseAmount(amount), note); onClose(); } catch (e) { setErr(e.message); } }}>Guardar</button>
      </div>
    </div><//>`;
}
function ExtraForm({ onClose }) {
  const [concept, setConcept] = useState('Magui'); const [amount, setAmount] = useState(''); const [date, setDate] = useState(ymd(new Date())); const [err, setErr] = useState('');
  return html`<${Sheet} title="Entrega suelta" onClose=${onClose}>
    <div class="sheet-body">
      <div class="grid2">
        <div class="field"><label>Concepto</label><input value=${concept} onInput=${e => setConcept(e.target.value)} /></div>
        <div class="field"><label>Monto</label><input inputmode="decimal" value=${amount} onInput=${e => setAmount(e.target.value)} /></div>
      </div>
      <div class="field"><label>Fecha</label><input type="date" value=${date} onInput=${e => setDate(e.target.value)} /></div>
      ${err && html`<div class="err-box" style="margin-bottom:10px">${err}</div>`}
      <button class="btn primary block" onClick=${async () => { try { if (!(parseAmount(amount) > 0)) throw new Error('Monto no válido'); await addHandover({ concept, amount: parseAmount(amount), date }); onClose(); } catch (e) { setErr(e.message); } }}>Agregar</button>
    </div><//>`;
}

// Tarjetas para Inicio (cartera Hogar)
export function HogarCards({ go }) {
  const S = useStore();
  const box = boxAccount();
  const pend = handoversList().filter(h => handoverStatus(h) !== 'ok');
  if (!box && !handoverRules().length) return null;
  return html`<div class="row" style="gap:10px;margin-bottom:14px">
    ${box && html`<button class="card grow" style="margin:0;text-align:left;padding:12px 14px" onClick=${() => go('cashbox')}>
      <div class="tiny muted" style="font-weight:600">💵 Caja chica</div><div class="num" style="font-size:20px;font-weight:750">${money(boxMovements().balance)}</div></button>`}
    ${handoverRules().length > 0 && html`<button class="card grow" style="margin:0;text-align:left;padding:12px 14px" onClick=${() => go('handovers')}>
      <div class="tiny muted" style="font-weight:600">🤝 Entregas</div><div style="font-size:15px;font-weight:700;margin-top:3px">${pend.length ? `⏳ ${pend.length} por confirmar` : '✅ Todo confirmado'}</div></button>`}
  </div>`;
}
