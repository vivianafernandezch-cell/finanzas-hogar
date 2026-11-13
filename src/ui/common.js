// Componentes compartidos
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { S, subscribe, walletLabel } from '../store.js';
import { money, compact } from '../logic/util.js';
import { spendOf } from '../logic/stats.js';

export { html };

// Re-render en cada cambio del store
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => subscribe(v => set(v)), []);
  return S;
}

// ---------- Toast global ----------
let toastSet = null;
export function toast(msg, actions = [], ms = 4500) { toastSet?.({ msg, actions, ms, key: Date.now() }); }
export function Toaster() {
  const [t, setT] = useState(null);
  toastSet = setT;
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), t.ms); return () => clearTimeout(id); }, [t]);
  if (!t) return null;
  return html`<div class="toast" role="status" key=${t.key}>
    <span class="grow">${t.msg}</span>
    ${t.actions.map(a => html`<button onClick=${() => { setT(null); a.fn(); }}>${a.label}</button>`)}
  </div>`;
}

// ---------- Hoja modal ----------
export function Sheet({ title, onClose, children, full = false, right = null, noHead = false }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, []);
  return html`<div>
    <div class="overlay" onClick=${onClose}></div>
    <div class=${'sheet' + (full ? ' full' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      ${!noHead && html`<div class="sheet-head">
        <button class="iconbtn flat" onClick=${onClose} aria-label="Cerrar">✕</button>
        <h2>${title}</h2>${right}
      </div>`}
      ${children}
    </div>
  </div>`;
}

export function Seg({ value, options, onChange, small }) {
  return html`<div class="seg" style=${small ? 'padding:3px' : ''}>
    ${options.map(([v, l]) => html`<button class=${value === v ? 'on' : ''} style=${small ? 'padding:7px 8px;font-size:14px' : ''} onClick=${() => onChange(v)}>${l}</button>`)}
  </div>`;
}

export function CatIcon({ cat, size = '', pending }) {
  const c = cat || { icon: '❔', color: '#8E8E93' };
  return html`<div class=${'caticon ' + size} style=${`background:${c.color}26`}>
    <span>${c.icon}</span>${pending && html`<i class="pend" title="Pendiente de sincronizar"></i>`}
  </div>`;
}

const TRANSFER_ICON = { icon: '⇄', color: '#64748B' };
export function TxRow({ t, onClick, showWallet = false }) {
  const cat = S.categories.get(t.category_id);
  const isMove = t.type === 'transfer' || t.type === 'card_payment';
  const acc = S.accounts.get(t.account_id), to = S.accounts.get(t.to_account_id);
  const title = isMove ? (t.description || (t.type === 'card_payment' ? 'Pago de tarjeta' : 'Transferencia')) : (cat?.name || 'Sin categoría');
  const who = t.created_by && t.created_by !== S.user.id ? (S.people[t.created_by]?.display_name || '') : '';
  const sub = [
    !isMove && t.description,
    isMove ? `${acc?.name || '?'} → ${to?.name || '?'}` : acc?.name,
    showWallet && walletLabel(S.wallets.get(t.wallet_id)),
    who && `por ${who}`,
    t.type === 'refund' && 'Reembolso',
  ].filter(Boolean).join(' · ');
  const sign = t.type === 'income' || t.type === 'refund' ? '+' : isMove ? '' : '−';
  const cls = t.type === 'income' || t.type === 'refund' ? 'inc' : isMove ? 'neu' : '';
  return html`<button class="tx" onClick=${() => onClick?.(t)}>
    <${CatIcon} cat=${isMove ? TRANSFER_ICON : cat} pending=${S.sync.pendingIds?.has(t.id)} />
    <div class="grow">
      <div class="t1 ellipsis">${title}</div>
      <div class="t2 ellipsis">${sub || ' '}</div>
      ${t.tags?.length ? html`<div class="row wrap" style="gap:4px;margin-top:4px">${t.tags.map(g => html`<span class="tag">#${g}</span>`)}</div>` : null}
    </div>
    <div class=${'amt ' + cls}>${sign}${money(t.amount_mxn).replace('−', '')}
      ${t.currency !== 'MXN' ? html`<span class="orig">${money(t.amount, t.currency)}</span>` : null}
    </div>
  </button>`;
}

// Lista agrupada por día con total diario
export function DayGroups({ txs, onOpen, showWallet, limit = Infinity }) {
  const groups = [];
  let cur = null;
  for (const t of txs.slice(0, limit)) {
    const d = new Date(t.occurred_at); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!cur || cur.k !== k) { cur = { k, items: [], total: 0 }; groups.push(cur); }
    cur.items.push(t); cur.total += spendOf(t);
  }
  return html`${groups.map(g => html`<div class="day" key=${g.k}>
    <div class="dayhead"><span>${dayLabelSafe(g.k)}</span><span class="num">${g.total ? money(-g.total) : ''}</span></div>
    <div class="list">${g.items.map(t => html`<${TxRow} key=${t.id} t=${t} onClick=${onOpen} showWallet=${showWallet} />`)}</div>
  </div>`)}`;
}
import { dayLabel } from '../logic/util.js';
const dayLabelSafe = k => dayLabel(k);

// ---------- Gráficas SVG ----------
export function BarChart({ data, height = 150, onPick, color = 'var(--expense)', color2 = 'var(--income)', showIncome = false }) {
  const W = 340, H = height, pad = 22;
  const realMax = Math.max(0, ...data.map(d => Math.max(d.value, showIncome ? d.value2 || 0 : 0)));
  const max = Math.max(1, realMax);
  const bw = (W - 8) / data.length;
  const ticks = realMax > 0 ? [0, max / 2, max] : [0];
  return html`<div class="bars"><svg viewBox=${`0 0 ${W} ${H + pad}`} role="img" aria-label="Gráfica de barras">
    ${ticks.map(v => { const y = H - (v / max) * (H - 14); return html`<line class="gridl" x1="0" x2=${W} y1=${y} y2=${y} /><text x="0" y=${y - 3}>${v ? compact(v) : ''}</text>`; })}
    ${data.map((d, i) => {
      const x = 8 + i * bw; const inner = showIncome ? bw * 0.32 : Math.min(bw * 0.5, 34);
      const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * (H - 14));
      const h2 = showIncome ? Math.max(d.value2 > 0 ? 3 : 0, ((d.value2 || 0) / max) * (H - 14)) : 0;
      const cx = x + bw / 2;
      return html`<g style=${onPick ? 'cursor:pointer' : ''} onClick=${() => onPick?.(d, i)}>
        <rect x=${x} y="0" width=${bw} height=${H} fill="transparent" />
        ${showIncome && html`<rect x=${cx + 1} y=${H - h2} width=${inner} height=${h2} rx="4" fill=${color2} opacity=${d.dim ? 0.35 : 0.9} />`}
        <rect x=${showIncome ? cx - inner - 1 : cx - inner / 2} y=${H - h} width=${inner} height=${h} rx="5" fill=${color} opacity=${d.dim ? 0.35 : 1} />
        <text x=${cx} y=${H + 16} text-anchor="middle" style=${d.dim ? '' : 'fill:var(--text)'}>${d.label}</text>
      </g>`;
    })}
  </svg></div>`;
}

export function Donut({ slices, size = 150, center }) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const r = 52, C = 2 * Math.PI * r; let off = 0;
  return html`<svg viewBox="0 0 140 140" width=${size} height=${size} role="img" aria-label="Distribución">
    <circle cx="70" cy="70" r=${r} fill="none" stroke="var(--surface2)" stroke-width="18" />
    ${slices.filter(s => s.value > 0).map(s => {
      const len = (s.value / total) * C; const el = html`<circle cx="70" cy="70" r=${r} fill="none" stroke=${s.color} stroke-width="18"
        stroke-dasharray=${`${Math.max(0, len - 1.5)} ${C}`} stroke-dashoffset=${-off} transform="rotate(-90 70 70)" />`;
      off += len; return el;
    })}
    ${center && html`<text x="70" y="66" text-anchor="middle" style="fill:var(--muted);font-size:10px;font-weight:600">${center[0]}</text>
      <text x="70" y="84" text-anchor="middle" style="fill:var(--text);font-size:15px;font-weight:750">${center[1]}</text>`}
  </svg>`;
}

export function Delta({ pct, invert = false }) {
  if (pct === null || pct === undefined || !isFinite(pct) || pct === 0) return null;
  const up = pct > 0; const good = invert ? up : !up;
  return html`<span class=${'delta ' + (pct === 0 ? '' : good ? 'down' : 'up')}>${up ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(Math.round(pct))}%</span>`;
}

export function Empty({ e = '🫧', children }) {
  return html`<div class="empty"><div class="e">${e}</div>${children}</div>`;
}

export function useOnline() {
  const [on, set] = useState(navigator.onLine);
  useEffect(() => { const a = () => set(true), b = () => set(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b); }; }, []);
  return on;
}

export function confirmAsk(msg) { return window.confirm(msg); }

export function downloadBlob(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function useAutoFocus() { const r = useRef(); useEffect(() => { r.current?.focus(); }, []); return r; }
