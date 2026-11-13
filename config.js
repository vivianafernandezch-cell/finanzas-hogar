// ⚙️ Configuración de la nube (Supabase).
// Vacío = MODO LOCAL: la app funciona completa pero solo en este dispositivo.
// Para activar la nube: pega aquí la "Project URL" y la "anon public key"
// (Supabase → Project Settings → API). Ambas son públicas por diseño;
// la seguridad la dan las políticas RLS de supabase/schema.sql.
// ⛔ NUNCA pongas aquí la "service_role key".
window.FH_CONFIG = {
  supabaseUrl: 'https://iuwybalkvnhddvgyxvfo.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1d3liYWxrdm5oZGR2Z3l4dmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MzU4OTQsImV4cCI6MjExMDExMTg5NH0.veNqWqj5WD896Bqwv-OHpm2IgLVVYme_F-bstaGOu_k',
};
