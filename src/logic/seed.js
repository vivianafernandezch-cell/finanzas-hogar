// Catálogo inicial (mismo que supabase/schema.sql → seed_categories). Sin "Mascotas".
export const DEFAULT_CATEGORIES = [
  ['Alimentos y bebidas', '🍽️', '#F5A524'], ['Supermercado', '🛒', '#22C55E'], ['Restaurantes', '🍝', '#F97316'],
  ['Hogar', '🏠', '#A47148'], ['Bebé / Hijos', '🧸', '#EC4899'], ['Transporte', '🚕', '#EAB308'],
  ['Automóvil', '🚗', '#3B82F6'], ['Gasolina', '⛽', '#EF4444'], ['Salud', '🩺', '#E11D48'],
  ['Belleza', '💅', '#D946EF'], ['Ropa', '👗', '#8B5CF6'], ['Compras', '🛍️', '#C026D3'],
  ['Regalos', '🎁', '#F43F5E'], ['Entretenimiento', '🎭', '#F59E0B'], ['Viajes', '✈️', '#06B6D4'],
  ['Educación', '🎓', '#6366F1'], ['Servicios', '💡', '#14B8A6'], ['Suscripciones', '📺', '#0EA5E9'],
  ['Donaciones', '🤲', '#84CC16'], ['Trabajo', '💼', '#64748B'], ['Deportes y hobbies', '🎾', '#10B981'],
  ['Otros', '📦', '#8E8E93'],
  ['Sueldo', '💰', '#16A34A', 'income'], ['Otros ingresos', '➕', '#059669', 'income'],
];

export const ACCOUNT_TYPES = {
  cash: { label: 'Efectivo', icon: '💵' }, debit: { label: 'Tarjeta de débito', icon: '💳' },
  credit: { label: 'Tarjeta de crédito', icon: '💳' }, bank: { label: 'Cuenta bancaria', icon: '🏦' },
  digital: { label: 'Cartera digital', icon: '📱' }, other: { label: 'Otro', icon: '🪙' },
};

export const TX_TYPES = {
  expense: { label: 'Gasto', short: 'Gasto' },
  income: { label: 'Ingreso', short: 'Ingreso' },
  transfer: { label: 'Transferencia entre cuentas', short: 'Transferencia' },
  card_payment: { label: 'Pago de tarjeta de crédito', short: 'Pago tarjeta' },
  refund: { label: 'Reembolso / devolución', short: 'Reembolso' },
};

export const CURRENCIES = ['MXN', 'USD', 'EUR', 'CAD', 'GBP', 'JPY', 'CHF', 'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'CNY', 'AUD', 'DKK', 'SEK', 'NOK', 'CZK', 'HUF', 'PLN', 'TRY', 'KRW', 'THB', 'INR'];

export const ICON_CHOICES = ['🍽️','🛒','🍝','☕','🍺','🥐','🏠','🧹','🛠️','🛋️','🧸','👶','🎒','🚕','🚌','🚇','🚗','⛽','🅿️','🩺','💊','🦷','💅','💇','👗','👟','🛍️','🎁','🎂','🎭','🎬','🎮','✈️','🏨','🧳','🎓','📚','💡','💧','📶','📱','📺','🎵','🤲','⛪','💼','🖨️','🎾','🏋️','⚽','🧘','📦','💰','➕','💵','💳','🏦','🪙','🎉','👰','🐚','🌮','🍣','🍷','🧾','🏥','🧴','🔧','🏫','🍼','🎨','🌴','🗽','🏖️','⭐'];
export const COLOR_CHOICES = ['#F5A524','#22C55E','#F97316','#A47148','#EC4899','#EAB308','#3B82F6','#EF4444','#E11D48','#D946EF','#8B5CF6','#C026D3','#F43F5E','#F59E0B','#06B6D4','#6366F1','#14B8A6','#0EA5E9','#84CC16','#64748B','#10B981','#8E8E93'];
