-- =====================================================================
--  PRUEBA DE SEGURIDAD (opcional pero recomendada) — correr DESPUÉS de schema.sql
--  Supabase → SQL Editor → pegar → Run.
--  Crea 2 usuarias de prueba DENTRO de una transacción y al final hace ROLLBACK:
--  no deja NADA guardado. Si todo está bien verás "✅ SEGURIDAD OK".
-- =====================================================================
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
 ('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prueba-v@ejemplo.test','{"name":"V"}',now(),now()),
 ('aaaaaaaa-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','prueba-a@ejemplo.test','{"name":"A"}',now(),now());

do $$
declare
  v uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  a uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_personal uuid; a_personal uuid; hogar uuid; code text; cat_v uuid; cat_h uuid; n int; ok boolean;
begin
  -- Cada alta creó su cartera "Mis gastos" + 22 categorías + Efectivo
  select id into v_personal from wallets where owner_id = v and kind = 'personal';
  select id into a_personal from wallets where owner_id = a and kind = 'personal';
  if v_personal is null or a_personal is null then raise exception '❌ No se creó la cartera personal'; end if;

  perform set_config('role', 'authenticated', true);

  -- ===== Como V =====
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  hogar := create_household();
  select invite_code into code from wallets where id = hogar;
  select id into cat_v from categories where wallet_id = v_personal and name = 'Belleza';
  select id into cat_h from categories where wallet_id = hogar and name = 'Supermercado';
  insert into transactions (wallet_id, amount, amount_mxn, category_id, description) values (v_personal, 500, 500, cat_v, 'PRIVADO de V');
  insert into transactions (wallet_id, amount, amount_mxn, category_id, description) values (hogar, 2500, 2500, cat_h, 'Súper compartido');

  -- ===== Como A (aún NO está en Hogar) =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from transactions;
  if n <> 0 then raise exception '❌ A ve % movimientos antes de unirse', n; end if;
  perform join_household(code);

  select count(*) into n from transactions;
  if n <> 1 then raise exception '❌ A debería ver solo 1 (Hogar) y ve %', n; end if;
  select count(*) into n from transactions where description = 'PRIVADO de V';
  if n <> 0 then raise exception '❌ A puede ver un gasto personal de V'; end if;
  select count(*) into n from wallets;
  if n <> 2 then raise exception '❌ A debería ver 2 carteras (las suyas) y ve %', n; end if;

  -- A intenta modificar el gasto personal de V (por id) → 0 filas
  update transactions set amount = 1, amount_mxn = 1 where description = 'PRIVADO de V';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '❌ A pudo modificar un gasto de V'; end if;

  -- A intenta insertar en la cartera personal de V → debe fallar
  ok := false;
  begin
    insert into transactions (wallet_id, amount, amount_mxn, description) values (v_personal, 1, 1, 'intruso');
  exception when others then ok := true; end;
  if not ok then raise exception '❌ A pudo escribir en la cartera de V'; end if;

  -- A sí puede registrar y editar en Hogar
  insert into transactions (wallet_id, amount, amount_mxn, category_id, description) values (hogar, 300, 300, cat_h, 'Hogar por A');
  update transactions set description = 'Súper compartido (editado por A)' where description = 'Súper compartido';
  get diagnostics n = row_count;
  if n <> 1 then raise exception '❌ A no pudo editar un gasto de Hogar'; end if;

  -- A no puede usar una categoría de otra cartera
  ok := false;
  begin
    insert into transactions (wallet_id, amount, amount_mxn, category_id) values (hogar, 1, 1, cat_v);
  exception when others then ok := true; end;
  if not ok then raise exception '❌ Se aceptó una categoría de otra cartera'; end if;

  -- A no puede cambiar quién registró un movimiento
  update transactions set created_by = a where description like 'Súper compartido%';
  select count(*) into n from transactions where description like 'Súper compartido%' and created_by = v;
  if n <> 1 then raise exception '❌ Se pudo cambiar created_by'; end if;

  -- ===== Como V: ve los 2 de Hogar + su personal =====
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  select count(*) into n from transactions;
  if n <> 3 then raise exception '❌ V debería ver 3 y ve %', n; end if;

  -- ===== Sin sesión (anónimo) =====
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  ok := false;
  begin perform count(*) from transactions; exception when others then ok := true; end;
  if not ok then raise exception '❌ Un visitante anónimo pudo consultar movimientos'; end if;

  raise notice '✅ SEGURIDAD OK: privacidad de "Mis gastos", Hogar compartido, sin acceso anónimo.';
end $$;

rollback;   -- no deja nada guardado
select '✅ Si no viste errores arriba, la seguridad funciona. (Nada quedó guardado)' as resultado;
