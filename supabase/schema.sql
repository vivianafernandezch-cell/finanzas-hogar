-- =====================================================================
--  FINANZAS HOGAR · Esquema de base de datos (Supabase / PostgreSQL)
--  Pegar COMPLETO en Supabase → SQL Editor → Run.  Es idempotente:
--  se puede volver a correr sin borrar datos.
--
--  Modelo:
--   wallets          → carteras. kind = 'personal' (Mis gastos) | 'household' (Hogar)
--   wallet_members   → quién pertenece a cada cartera (la privacidad vive aquí)
--   categories       → por cartera (Hogar tiene categorías compartidas)
--   accounts         → cuentas / métodos de pago, por persona
--   transactions     → movimientos (gasto, ingreso, transferencia, reembolso, pago de tarjeta)
--   budgets          → presupuestos mensuales por cartera / categoría
--   recurring        → gastos programados
--   import_batches   → cada importación (para poder revertirla completa)
--
--  Regla de oro: TODA lectura/escritura pasa por RLS con is_member(wallet_id).
-- =====================================================================

-- (gen_random_uuid() es nativo de PostgreSQL 13+, no requiere extensiones)

-- ---------- Tablas ----------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('personal','household')),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null default '',
  invite_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.wallet_members (
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (wallet_id, user_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  parent_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default '🏷️',
  color text not null default '#8E8E93' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  kind text not null default 'expense' check (kind in ('expense','income')),
  sort int not null default 0,
  favorite boolean not null default false,
  hidden boolean not null default false,
  merged_into uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 60),
  type text not null default 'cash' check (type in ('cash','debit','credit','bank','digital','other')),
  icon text not null default '💵',
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  sort int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  filename text not null default '',
  row_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reverted_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.recurring (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  type text not null default 'expense' check (type in ('expense','income')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  description text not null default '' check (char_length(description) <= 200),
  frequency text not null check (frequency in ('daily','weekly','biweekly','monthly','yearly')),
  next_date date not null,
  end_date date,
  auto_confirm boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),           -- lo genera el teléfono → evita duplicados al sincronizar
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  type text not null default 'expense'
       check (type in ('expense','income','transfer','refund','card_payment')),
  amount numeric(14,2) not null check (amount > 0),         -- importe ORIGINAL (siempre positivo)
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18,8) not null default 1 check (fx_rate > 0),  -- MXN por 1 unidad de la moneda original
  amount_mxn numeric(14,2) not null check (amount_mxn >= 0),     -- congelado al registrar
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  to_account_id uuid references public.accounts(id) on delete set null,
  description text not null default '' check (char_length(description) <= 200),
  note text not null default '' check (char_length(note) <= 2000),
  tags text[] not null default '{}',
  occurred_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) default auth.uid(),
  paid_by uuid references auth.users(id),
  receipt_path text,
  recurring_id uuid references public.recurring(id) on delete set null,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  import_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,  -- null = total de la cartera
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- Índices ---------------------------------------------------
create index if not exists tx_wallet_date on public.transactions (wallet_id, occurred_at desc);
create index if not exists tx_updated on public.transactions (updated_at);
create index if not exists tx_batch on public.transactions (import_batch_id);
create index if not exists cat_wallet on public.categories (wallet_id);
create index if not exists cat_updated on public.categories (updated_at);
create index if not exists acc_updated on public.accounts (updated_at);
create index if not exists bud_wallet on public.budgets (wallet_id);
create index if not exists rec_wallet on public.recurring (wallet_id);
create index if not exists wm_user on public.wallet_members (user_id);

-- ---------- updated_at automático (base del "último cambio gana") ----
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_at := coalesce(new.created_at, now()); else new.created_at := old.created_at; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','wallets','categories','accounts','import_batches','recurring','transactions','budgets'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- Funciones de permisos -------------------------------------
create or replace function public.is_member(w uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from wallet_members m where m.wallet_id = w and m.user_id = auth.uid());
$$;

-- ¿Comparto alguna cartera con esa persona? (para ver el nombre de su cuenta en gastos de Hogar)
create or replace function public.shares_wallet_with(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select other = auth.uid() or exists (
    select 1 from wallet_members a join wallet_members b on a.wallet_id = b.wallet_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

-- ---------- Integridad: la categoría debe ser de la MISMA cartera ------
create or replace function public.check_tx_integrity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.category_id is not null and not exists
     (select 1 from categories c where c.id = new.category_id and c.wallet_id = new.wallet_id) then
    raise exception 'La categoría no pertenece a la cartera';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.paid_by := coalesce(new.paid_by, new.created_by);
  else
    new.created_by := old.created_by;                 -- nadie puede cambiar quién lo registró
  end if;
  if new.paid_by is not null and not exists
     (select 1 from wallet_members m where m.wallet_id = new.wallet_id and m.user_id = new.paid_by) then
    raise exception 'paid_by debe ser integrante de la cartera';
  end if;
  return new;
end $$;
drop trigger if exists trg_tx_integrity on public.transactions;
create trigger trg_tx_integrity before insert or update on public.transactions
  for each row execute function public.check_tx_integrity();

-- ---------- Alta automática: perfil + cartera "Mis gastos" + categorías -
create or replace function public.seed_categories(w uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d jsonb := '[
 ["Alimentos y bebidas","🍽️","#F5A524"],["Supermercado","🛒","#22C55E"],["Restaurantes","🍝","#F97316"],
 ["Hogar","🏠","#A47148"],["Bebé / Hijos","🧸","#EC4899"],["Transporte","🚕","#EAB308"],
 ["Automóvil","🚗","#3B82F6"],["Gasolina","⛽","#EF4444"],["Salud","🩺","#E11D48"],
 ["Belleza","💅","#D946EF"],["Ropa","👗","#8B5CF6"],["Compras","🛍️","#C026D3"],
 ["Regalos","🎁","#F43F5E"],["Entretenimiento","🎭","#F59E0B"],["Viajes","✈️","#06B6D4"],
 ["Educación","🎓","#6366F1"],["Servicios","💡","#14B8A6"],["Suscripciones","📺","#0EA5E9"],
 ["Donaciones","🤲","#84CC16"],["Trabajo","💼","#64748B"],["Deportes y hobbies","🎾","#10B981"],
 ["Otros","📦","#8E8E93"],
 ["Sueldo","💰","#16A34A","income"],["Otros ingresos","➕","#059669","income"]]';
 i int;
begin
  if exists (select 1 from categories where wallet_id = w) then return; end if;
  for i in 0 .. jsonb_array_length(d) - 1 loop
    insert into categories (wallet_id, name, icon, color, kind, sort)
    values (w, d->i->>0, d->i->>1, d->i->>2, coalesce(d->i->>3,'expense'), i);
  end loop;
end $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare w uuid;
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  insert into wallets (kind, owner_id, name) values ('personal', new.id, 'Mis gastos') returning id into w;
  insert into wallet_members (wallet_id, user_id, role) values (w, new.id, 'owner');
  perform seed_categories(w);
  insert into accounts (owner_id, name, type, icon) values (new.id, 'Efectivo', 'cash', '💵');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Hogar: crear (una vez) y unirse con código ----------------
create or replace function public.create_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare w uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select m.wallet_id into w from wallet_members m join wallets x on x.id = m.wallet_id
   where m.user_id = auth.uid() and x.kind = 'household' and x.deleted_at is null limit 1;
  if w is not null then return w; end if;
  insert into wallets (kind, owner_id, name, invite_code)
  values ('household', auth.uid(), 'Hogar', upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)))
  returning id into w;
  insert into wallet_members (wallet_id, user_id, role) values (w, auth.uid(), 'owner');
  perform seed_categories(w);
  return w;
end $$;

create or replace function public.join_household(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare w uuid;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select id into w from wallets where invite_code = upper(trim(code)) and kind = 'household' and deleted_at is null;
  if w is null then raise exception 'Código no válido'; end if;
  if (select count(*) from wallet_members where wallet_id = w) >= 6 then raise exception 'Hogar lleno'; end if;
  insert into wallet_members (wallet_id, user_id) values (w, auth.uid()) on conflict do nothing;
  return w;
end $$;

-- Lista de integrantes de mis carteras (solo nombre, para "registrado por")
create or replace function public.my_people() returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name from profiles p where public.shares_wallet_with(p.id);
$$;

revoke all on function public.seed_categories(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.create_household() to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.my_people() to authenticated;
-- Necesarias para que las políticas RLS puedan evaluarse (aunque no se "expongan" tablas automáticamente)
grant usage on schema public to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.shares_wallet_with(uuid) to authenticated;

-- ---------- RLS: seguridad a nivel de fila ----------------------------
alter table public.profiles        enable row level security;
alter table public.wallets         enable row level security;
alter table public.wallet_members  enable row level security;
alter table public.categories      enable row level security;
alter table public.accounts        enable row level security;
alter table public.import_batches  enable row level security;
alter table public.recurring       enable row level security;
alter table public.transactions    enable row level security;
alter table public.budgets         enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Perfiles: veo el mío y el de quien comparte cartera conmigo; solo edito el mío
create policy prof_sel on public.profiles for select using (public.shares_wallet_with(id));
create policy prof_upd on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Carteras: solo las que integro. Se crean únicamente vía triggers/funciones.
create policy wal_sel on public.wallets for select using (public.is_member(id));
create policy wal_upd on public.wallets for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy wm_sel on public.wallet_members for select using (public.is_member(wallet_id));

-- Categorías, movimientos, presupuestos, recurrentes: integrante de la cartera
create policy cat_all on public.categories for all
  using (public.is_member(wallet_id)) with check (public.is_member(wallet_id));
create policy tx_all on public.transactions for all
  using (public.is_member(wallet_id)) with check (public.is_member(wallet_id));
create policy bud_all on public.budgets for all
  using (public.is_member(wallet_id)) with check (public.is_member(wallet_id));
create policy rec_all on public.recurring for all
  using (public.is_member(wallet_id)) with check (public.is_member(wallet_id));

-- Cuentas: las administra su dueño; quien comparte Hogar solo puede LEER el nombre
create policy acc_sel on public.accounts for select using (public.shares_wallet_with(owner_id));
create policy acc_ins on public.accounts for insert with check (owner_id = auth.uid());
create policy acc_upd on public.accounts for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy acc_del on public.accounts for delete using (owner_id = auth.uid());

create policy imp_all on public.import_batches for all
  using (created_by = auth.uid()) with check (created_by = auth.uid());

-- Los invitados anónimos no ven nada
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------- Fotos de tickets (Storage) --------------------------------
insert into storage.buckets (id, name, public) values ('receipts','receipts', false)
on conflict (id) do nothing;

drop policy if exists rcpt_rw on storage.objects;
create policy rcpt_rw on storage.objects for all to authenticated
  using (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid));

-- Listo ✅
