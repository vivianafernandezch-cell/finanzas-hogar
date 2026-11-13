// Importador de historial (Spendee CSV/Excel u otro) — lógica pura, sin DOM.
// Formato típico de Spendee: Date, Wallet, Type, Category name, Amount, Currency, Note, Labels, Author
import { parseAmount, norm, round2 } from './util.js';

export const FIELDS = [
  { key: 'date', label: 'Fecha', required: true, syn: ['date', 'fecha', 'datetime', 'día', 'dia', 'created'] },
  { key: 'amount', label: 'Importe', required: true, syn: ['amount', 'importe', 'monto', 'cantidad', 'valor', 'total'] },
  { key: 'currency', label: 'Moneda', syn: ['currency', 'moneda', 'divisa'] },
  { key: 'category', label: 'Categoría', syn: ['category name', 'category', 'categoria', 'categoría'] },
  { key: 'type', label: 'Tipo', syn: ['type', 'tipo'] },
  { key: 'description', label: 'Descripción', syn: ['note', 'nota', 'description', 'descripcion', 'descripción', 'concepto', 'memo'] },
  { key: 'wallet', label: 'Cartera / Cuenta de Spendee', syn: ['wallet', 'cartera', 'billetera'] },
  { key: 'account', label: 'Cuenta / Método de pago', syn: ['account', 'cuenta', 'metodo', 'método', 'payment'] },
  { key: 'labels', label: 'Etiquetas', syn: ['labels', 'label', 'tags', 'etiquetas', 'etiqueta'] },
  { key: 'fx', label: 'Tipo de cambio', syn: ['exchange rate', 'tipo de cambio', 'rate', 'fx'] },
  { key: 'amount_mxn', label: 'Importe en MXN', syn: ['amount in mxn', 'importe mxn', 'amount_mxn'] },
];

export function autoMap(headers) {
  const map = {}; const used = new Set();
  for (const f of FIELDS) {
    // 1) igualdad exacta, 2) contiene
    let h = headers.find(h => !used.has(h) && f.syn.includes(norm(h)));
    if (!h) h = headers.find(h => !used.has(h) && f.syn.some(s => norm(h).includes(s)));
    if (h) { map[f.key] = h; used.add(h); }
  }
  return map;
}

// Fechas: ISO, "2023-08-14 18:23", "14/08/2023", "14/08/2023 18:23", número de serie de Excel, Date
export function parseDate(v, dayFirst = true) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {                          // serie de Excel
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    if (m[7]) { const d = new Date(s.replace(' ', 'T')); return isNaN(d) ? null : d; }
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
  }
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let day = dayFirst ? a : b, mon = dayFirst ? b : a;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    const d = new Date(y, mon - 1, day, +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
    return isNaN(d) || d.getMonth() !== mon - 1 ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

export function parseType(raw, amount, signMeansIncome = false) {
  const t = norm(raw);
  if (/transfer/.test(t)) return 'transfer';
  if (/refund|reembolso|devoluc/.test(t)) return 'refund';
  if (/income|ingreso/.test(t)) return 'income';
  if (/expense|gasto/.test(t)) return 'expense';
  return amount > 0 && signMeansIncome ? 'income' : 'expense';
}

// Equivalencias Spendee (inglés) → categorías nuevas
export const CATEGORY_SYNONYMS = {
  'food & drink': 'Alimentos y bebidas', 'food and drink': 'Alimentos y bebidas', 'alimentos y bebidas': 'Alimentos y bebidas',
  'groceries': 'Supermercado', 'supermercado': 'Supermercado', 'restaurant': 'Restaurantes', 'restaurants': 'Restaurantes',
  'home': 'Hogar', 'hogar': 'Hogar', 'housing': 'Hogar', 'transport': 'Transporte', 'transportation': 'Transporte',
  'car': 'Automóvil', 'auto': 'Automóvil', 'fuel': 'Gasolina', 'gas': 'Gasolina', 'healthcare': 'Salud', 'health': 'Salud',
  'beauty': 'Belleza', 'clothes': 'Ropa', 'clothing': 'Ropa', 'shopping': 'Compras', 'gifts': 'Regalos', 'gift': 'Regalos',
  'entertainment': 'Entretenimiento', 'travel': 'Viajes', 'viaje': 'Viajes', 'education': 'Educación',
  'bills & fees': 'Servicios', 'bills and fees': 'Servicios', 'bills': 'Servicios', 'utilities': 'Servicios',
  'subscriptions': 'Suscripciones', 'charity': 'Donaciones', 'donations': 'Donaciones', 'donacion': 'Donaciones', 'donativos': 'Donaciones', 'work': 'Trabajo',
  'sport & hobbies': 'Deportes y hobbies', 'sports': 'Deportes y hobbies', 'hobbies': 'Deportes y hobbies',
  'other': 'Otros', 'others': 'Otros', 'bebe': 'Bebé / Hijos', 'baby': 'Bebé / Hijos', 'kids': 'Bebé / Hijos', 'hijos': 'Bebé / Hijos',
  'family & personal': 'Bebé / Hijos', 'salary': 'Sueldo', 'sueldo': 'Sueldo', 'extra income': 'Otros ingresos',
};

// Sugerencia de categoría destino: devuelve id existente o null (= crear nueva con el mismo nombre)
export function suggestCategory(name, categories) {
  const n = norm(name);
  if (!n) return null;
  const exact = categories.find(c => norm(c.name) === n);
  if (exact) return exact.id;
  const syn = CATEGORY_SYNONYMS[n];
  if (syn) { const c = categories.find(c => norm(c.name) === norm(syn)); if (c) return c.id; }
  return null;
}

export const txHash = r =>
  [r.occurred_at.slice(0, 16), round2(r.amount).toFixed(2), r.currency, r.type, norm(r.description).slice(0, 60)].join('|');

/**
 * Convierte filas crudas → movimientos validados.
 * opts: { map, dayFirst, defaultCurrency, walletFor(rawWallet)→walletId|null, categoryFor(walletId, rawCat, type)→catId|null,
 *         accountFor(rawAccount)→accountId|null, existingHashes:Set }
 * Devuelve { ok:[], errors:[{row, msg}], skipped:[{row,msg}], duplicates:[{row, tx}] }
 */
export function buildRows(rows, opts) {
  const { map, dayFirst = true, defaultCurrency = 'MXN', existingHashes = new Set() } = opts;
  const out = { ok: [], errors: [], skipped: [], duplicates: [] };
  const seen = new Set();
  const signMeansIncome = !!map.amount && rows.some(r => parseAmount(r[map.amount]) < 0);
  rows.forEach((r, i) => {
    const rowNo = i + 2;                                  // +1 encabezado, +1 base 1
    const get = k => map[k] ? r[map[k]] : undefined;
    const date = parseDate(get('date'), dayFirst);
    if (!date) return out.errors.push({ row: rowNo, msg: `Fecha no válida: "${get('date') ?? ''}"` });
    const rawAmt = parseAmount(get('amount'));
    if (isNaN(rawAmt)) return out.errors.push({ row: rowNo, msg: `Importe no válido: "${get('amount') ?? ''}"` });
    if (rawAmt === 0) return out.skipped.push({ row: rowNo, msg: 'Importe en cero' });
    const type = parseType(get('type'), rawAmt, signMeansIncome);
    const currency = (String(get('currency') || defaultCurrency).trim().toUpperCase().match(/[A-Z]{3}/) || [defaultCurrency])[0];
    const amount = round2(Math.abs(rawAmt));
    let fx = 1;
    const mxnCol = parseAmount(get('amount_mxn'));
    const fxCol = parseAmount(get('fx'));
    if (currency !== 'MXN') {
      if (!isNaN(fxCol) && fxCol > 0) fx = fxCol;
      else if (!isNaN(mxnCol) && mxnCol !== 0) fx = Math.abs(mxnCol) / amount;
      else fx = opts.fxFor?.(currency, date) || 0;
      if (!fx) return out.errors.push({ row: rowNo, msg: `Falta tipo de cambio para ${currency}` });
    }
    const walletId = opts.walletFor ? opts.walletFor(String(get('wallet') ?? '').trim()) : opts.walletId;
    if (!walletId) return out.skipped.push({ row: rowNo, msg: `Cartera "${get('wallet')}" sin asignar (omitida)` });
    const rawCat = String(get('category') ?? '').trim();
    const description = String(get('description') ?? '').trim().slice(0, 200);
    const tags = String(get('labels') ?? '').split(/[,;|#]/).map(s => s.trim()).filter(Boolean);
    const tx = {
      wallet_id: walletId, type, amount, currency, fx_rate: round2(fx * 1e6) / 1e6,
      amount_mxn: round2(amount * fx),
      category_id: type === 'transfer' ? null : (opts.categoryFor ? opts.categoryFor(walletId, rawCat, type) : null),
      account_id: opts.accountFor ? opts.accountFor(String(get('account') ?? '').trim()) : null,
      description, note: '', tags, occurred_at: date.toISOString(), _raw_category: rawCat,
    };
    tx.import_hash = txHash(tx);
    if (existingHashes.has(tx.import_hash) || seen.has(tx.import_hash)) {
      out.duplicates.push({ row: rowNo, tx });
      return;
    }
    seen.add(tx.import_hash);
    out.ok.push(tx);
  });
  return out;
}

// Detecta si las fechas vienen como mes/día (EE.UU.) en vez de día/mes
export function guessDayFirst(values) {
  let dayFirstVotes = 0, monthFirstVotes = 0;
  for (const v of values.slice(0, 500)) {
    const m = String(v ?? '').match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-]/);
    if (!m) continue;
    if (+m[1] > 12) dayFirstVotes++; else if (+m[2] > 12) monthFirstVotes++;
  }
  return monthFirstVotes <= dayFirstVotes;
}
