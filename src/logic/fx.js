// Tipo de cambio sugerido (Frankfurter / Banco Central Europeo, gratis, sin llave).
// Solo se envía el par de monedas (ej. USD→MXN): NINGÚN dato tuyo sale del teléfono.
// Siempre es editable y el movimiento guarda el tipo de cambio usado (nunca se recalcula después).
const KEY = 'fh:fx';
function cache() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }

export function lastKnownRate(cur) { return cache()[cur]?.rate || null; }

export async function suggestRate(cur, dateStr) {
  if (cur === 'MXN') return { rate: 1, source: 'MXN' };
  const c = cache(); const today = new Date().toISOString().slice(0, 10);
  const key = dateStr && dateStr !== today ? `${cur}@${dateStr}` : cur;
  if (c[key] && (c[key].day === today || key.includes('@'))) return { rate: c[key].rate, source: 'guardado' };
  try {
    const path = dateStr && dateStr < today ? dateStr : 'latest';
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://api.frankfurter.dev/v1/${path}?from=${cur}&to=MXN`, { signal: ctl.signal });
    clearTimeout(tm);
    if (!r.ok) throw new Error('fx ' + r.status);
    const j = await r.json(); const rate = j?.rates?.MXN;
    if (!rate) throw new Error('sin tasa');
    c[key] = { rate, day: today }; if (key === cur) c[cur] = { rate, day: today };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
    return { rate, source: `BCE ${j.date}` };
  } catch {
    const prev = c[cur]?.rate;
    return prev ? { rate: prev, source: 'último conocido (sin internet)' } : { rate: null, source: 'escríbelo a mano' };
  }
}

export function rememberRate(cur, rate) {
  if (cur === 'MXN' || !(rate > 0)) return;
  const c = cache(); c[cur] = { rate, day: c[cur]?.day || '' };
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
}

// Serie histórica diaria (para importar años de historial con el tipo de cambio de cada fecha).
// Devuelve una función (fecha 'YYYY-MM-DD') → tasa del día hábil más cercano anterior.
export async function historicalRates(cur, fromDate, toDate) {
  const r = await fetch(`https://api.frankfurter.dev/v1/${fromDate}..${toDate}?from=${cur}&to=MXN`);
  if (!r.ok) throw new Error('No se pudo consultar el tipo de cambio histórico');
  const j = await r.json();
  const days = Object.keys(j.rates || {}).sort();
  if (!days.length) throw new Error('Sin datos históricos para ' + cur);
  const map = Object.fromEntries(days.map(d => [d, j.rates[d].MXN]));
  return date => {
    if (map[date]) return map[date];
    let lo = 0, hi = days.length - 1, best = days[0];
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (days[mid] <= date) { best = days[mid]; lo = mid + 1; } else hi = mid - 1; }
    return map[best];
  };
}
