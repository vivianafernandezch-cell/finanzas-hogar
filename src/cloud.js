// Adaptador de Supabase. La URL y la "anon key" son PÚBLICAS por diseño:
// la seguridad real está en las políticas RLS de la base de datos (supabase/schema.sql).
// NUNCA poner aquí la "service_role key".
const cfg = window.FH_CONFIG || {};
export const cloudConfigured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
export const sb = cloudConfigured
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fh-auth' } })
  : null;

const PAGE = 1000;

function check({ data, error }) {
  if (error) { const e = new Error(error.message || 'Error de servidor'); e.status = error.status ?? error.code; e.details = error; throw e; }
  return data;
}

export const remote = {
  async upsert(table, rows) { if (rows.length) check(await sb.from(table).upsert(rows, { onConflict: 'id' })); },
  async pull(table, sinceIso) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const data = check(await sb.from(table).select('*').gt('updated_at', sinceIso).order('updated_at').order('id').range(from, from + PAGE - 1));
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  },
  async fetchWallets() {
    const wallets = check(await sb.from('wallets').select('*').is('deleted_at', null));
    const people = check(await sb.rpc('my_people')) || [];
    return { wallets, people };
  },
  async createHousehold() { return check(await sb.rpc('create_household')); },
  async joinHousehold(code) { return check(await sb.rpc('join_household', { code })); },
  async rpc(name, args) { return check(await sb.rpc(name, args)); },
  async uploadReceipt(path, blob) {
    check(await sb.storage.from('receipts').upload(path, blob, { upsert: true, contentType: 'image/jpeg' }));
    return path;
  },
  async receiptUrl(path) {
    const d = check(await sb.storage.from('receipts').createSignedUrl(path, 3600));
    return d.signedUrl;
  },
};

export const auth = {
  async session() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
  async signIn(email, password) { return check(await sb.auth.signInWithPassword({ email, password })); },
  async signOut() { await sb.auth.signOut(); },
  async resetPassword(email) { return check(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
  async updatePassword(password) { return check(await sb.auth.updateUser({ password })); },
  onChange(fn) { return sb?.auth.onAuthStateChange((ev, s) => fn(ev, s)); },
};
