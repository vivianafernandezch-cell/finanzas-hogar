// Gastos recurrentes: calcula fechas y qué está pendiente de confirmar
import { ymd } from './util.js';

export const FREQS = {
  daily: 'Diario', weekly: 'Semanal', biweekly: 'Quincenal', monthly: 'Mensual', yearly: 'Anual',
};

export function nextDate(dateStr, freq) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let x;
  switch (freq) {
    case 'daily': x = new Date(y, m - 1, d + 1); break;
    case 'weekly': x = new Date(y, m - 1, d + 7); break;
    case 'biweekly': x = new Date(y, m - 1, d + 14); break;
    case 'yearly': {
      x = new Date(y + 1, m - 1, 1);
      x.setDate(Math.min(d, new Date(y + 1, m, 0).getDate()));
      break;
    }
    default: {                                       // mensual: respeta fin de mes (31 → 30/28)
      x = new Date(y, m, 1);
      x.setDate(Math.min(d, new Date(y, m + 1, 0).getDate()));
    }
  }
  return ymd(x);
}

// Ocurrencias vencidas (<= hoy) que aún no se han confirmado
export function dueOccurrences(rule, today = new Date(), max = 24) {
  if (!rule.active || rule.deleted_at) return [];
  const out = []; let d = rule.next_date; const t = ymd(today);
  while (d <= t && out.length < max) {
    if (rule.end_date && d > rule.end_date) break;
    out.push(d); d = nextDate(d, rule.frequency);
  }
  return out;
}

// Próximas N fechas (para mostrar en "Programados")
export function upcoming(rule, n = 3) {
  const out = []; let d = rule.next_date;
  while (out.length < n) { if (rule.end_date && d > rule.end_date) break; out.push(d); d = nextDate(d, rule.frequency); }
  return out;
}

// Equivalente mensual (para "gastos recurrentes" en estadísticas)
export function monthlyEquivalent(rule) {
  const a = +rule.amount;
  return { daily: a * 30.4, weekly: a * 4.345, biweekly: a * 2.17, monthly: a, yearly: a / 12 }[rule.frequency] || a;
}
