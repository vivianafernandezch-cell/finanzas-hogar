// Utilidades puras (sin DOM) — probadas en tests/
export const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

export const nowIso = () => new Date().toISOString();

export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// "1,234.50" | "1234,5" | "$ 20" → número
export function parseAmount(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  let s = String(v).trim().replace(/[^\d,.\-]/g, '');
  if (!s) return NaN;
  const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
  if (lastC > -1 && lastD > -1) {
    if (lastC > lastD) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  } else if (lastC > -1) {
    const dec = s.length - lastC - 1;
    s = (dec === 3 && s.indexOf(',') === lastC && !s.startsWith('-0')) ? s.replace(',', '') : s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

const fmtCache = {};
export function money(n, cur = 'MXN', { sign = false, decimals } = {}) {
  const v = Number(n) || 0;
  const d = decimals ?? (Math.abs(v) % 1 === 0 ? 0 : 2);
  const key = cur + d;
  if (!fmtCache[key]) {
    try {
      fmtCache[key] = new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d });
    } catch { fmtCache[key] = new Intl.NumberFormat('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  }
  let out = fmtCache[key].format(Math.abs(v));
  if (cur !== 'MXN' && !/[A-Z]{3}/.test(out) && !out.includes('US$') && !out.includes('€')) out = out + ' ' + cur;
  if (v < 0) out = '−' + out; else if (sign && v > 0) out = '+' + out;
  return out;
}

export const compact = n => {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.0', '') + 'k';
  return String(Math.round(n));
};

// ---------- Fechas (todo en hora local del dispositivo) ----------
export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysInMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MES3 = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
export const monthName = (d, short = false) => short ? MES3[d.getMonth()] : MESES[d.getMonth()];
export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

export function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const today = ymd(new Date()), yest = ymd(addDays(new Date(), -1));
  if (dateStr === today) return 'Hoy';
  if (dateStr === yest) return 'Ayer';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${cap(DIAS[d.getDay()])} ${d.getDate()} de ${MESES[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}

// Periodos de la pantalla principal
export function periodRange(key, custom, ref = new Date()) {
  const som = startOfMonth(ref);
  switch (key) {
    case 'prev': return { from: addMonths(som, -1), to: som, label: cap(monthName(addMonths(som, -1))) };
    case '3m': return { from: addMonths(som, -2), to: addMonths(som, 1), label: 'Últimos 3 meses' };
    case 'year': return { from: new Date(ref.getFullYear(), 0, 1), to: new Date(ref.getFullYear() + 1, 0, 1), label: String(ref.getFullYear()) };
    case 'custom': {
      const f = custom?.from ? new Date(custom.from + 'T00:00:00') : som;
      const t = custom?.to ? addDays(new Date(custom.to + 'T00:00:00'), 1) : addMonths(som, 1);
      return { from: f, to: t, label: `${custom?.from || ''} → ${custom?.to || ''}` };
    }
    default: return { from: som, to: addMonths(som, 1), label: 'Este mes' };
  }
}
// Mismo largo, inmediatamente antes
export function previousRange({ from, to }) {
  const sameMonthShape = from.getDate() === 1 && to.getDate() === 1;
  if (sameMonthShape) {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
    return { from: addMonths(from, -months), to: from };
  }
  const ms = to - from;
  return { from: new Date(from - ms), to: from };
}

// Período anterior "justo": si el período actual va en curso, compara contra el mismo tramo transcurrido
export function comparableRange(range, now = new Date()) {
  const prev = previousRange(range);
  if (range.to <= now) return { ...prev, partial: false };
  const elapsed = now - range.from;
  return { from: prev.from, to: new Date(Math.min(prev.to.getTime(), prev.from.getTime() + elapsed)), partial: true };
}

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
