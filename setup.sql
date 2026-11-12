-- =====================================================================
-- Tindero POS · Supabase setup — run ONCE per store/client:
--   Supabase → SQL Editor → New query → paste ALL of this → Run.
-- Safe to run again (it only adds/updates). One Supabase project per store.
-- =====================================================================

-- ---------- 1. Records: every product, sale, purchase, stock move, user, photo ----------
-- Stock is never overwritten: it is the sum of append-only movements.
create table if not exists public.pos_records (
  id          text primary key,
  kind        text not null,
  data        jsonb not null,
  deleted     boolean not null default false,
  client_ts   bigint not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists pos_records_updated_idx on public.pos_records (updated_at);
create index if not exists pos_records_kind_idx    on public.pos_records (kind);

-- Server-side guard: an older offline edit never overwrites a newer one,
-- a record can't change type, and a record can't be blanked.
create or replace function public.pos_records_lww() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.client_ts < old.client_ts then return old; end if;
    if new.kind is distinct from old.kind then return old; end if;
    if new.data is null or new.data = '{}'::jsonb then return old; end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists pos_records_lww on public.pos_records;
create trigger pos_records_lww before insert or update on public.pos_records
  for each row execute function public.pos_records_lww();

-- ---------- 2. What the app's sync key may do ----------
-- The app (publishable/anon key) can only READ and SAVE (upsert). It can never
-- delete, truncate, or read the history/secret tables below.
alter table public.pos_records enable row level security;
revoke all on public.pos_records from anon, authenticated;
grant select, insert, update on public.pos_records to anon, authenticated;
drop policy if exists pos_app_rw  on public.pos_records;
drop policy if exists pos_app_sel on public.pos_records;
drop policy if exists pos_app_ins on public.pos_records;
drop policy if exists pos_app_upd on public.pos_records;
create policy pos_app_sel on public.pos_records for select to anon, authenticated using (true);
create policy pos_app_ins on public.pos_records for insert to anon, authenticated
  with check (kind in ('branch','close','move','photo','pricelog','product','purchase','receipt','sale','settings','shared','slist','user')
              and length(id) <= 120 and data is not null and pg_column_size(data) < 4000000 and deleted = false);
create policy pos_app_upd on public.pos_records for update to anon, authenticated using (true)
  with check (data is not null and pg_column_size(data) < 4000000 and deleted = false);

-- ---------- 3. History: every overwritten version is kept (recovery) ----------
create table if not exists public.pos_records_history (
  hid        bigserial primary key,
  id         text not null,
  kind       text not null,
  data       jsonb not null,
  client_ts  bigint not null default 0,
  changed_at timestamptz not null default now()
);
create index if not exists pos_records_history_id_idx on public.pos_records_history (id, changed_at desc);
alter table public.pos_records_history enable row level security;
revoke all on public.pos_records_history from anon, authenticated;
revoke all on sequence public.pos_records_history_hid_seq from anon, authenticated;

create or replace function public.pos_records_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.data is distinct from new.data then
    insert into public.pos_records_history (id, kind, data, client_ts) values (old.id, old.kind, old.data, old.client_ts);
  end if;
  return null;
end $$;
revoke all on function public.pos_records_keep_history() from public, anon, authenticated;
drop trigger if exists pos_records_history on public.pos_records;
create trigger pos_records_history after update on public.pos_records
  for each row execute function public.pos_records_keep_history();

-- To undo a bad overwrite (SQL Editor, as owner):
--   select hid, changed_at, data from pos_records_history where id = '<record id>' order by changed_at desc;
--   update pos_records set data = (select data from pos_records_history where hid = <hid>),
--          client_ts = (extract(epoch from now())*1000)::bigint where id = '<record id>';

-- ---------- 4. Server-only secrets (never readable by the app) ----------
create table if not exists public.pos_secrets (id text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.pos_secrets enable row level security;
revoke all on public.pos_secrets from anon, authenticated;

-- ---------- 5. AI reader queue (receipts, supplier price lists, tingi price) ----------
-- The app adds a job; the database calls the edge function "read-receipt"; the result is written back.
create extension if not exists pg_net with schema extensions;
create table if not exists public.pos_ai_jobs (
  id         text primary key,
  status     text not null default 'queued',
  image      text,
  cats       jsonb,
  result     jsonb,
  error      text,
  model      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pos_ai_jobs enable row level security;
revoke all on public.pos_ai_jobs from anon, authenticated;
grant select, insert on public.pos_ai_jobs to anon, authenticated;
drop policy if exists pos_ai_jobs_insert on public.pos_ai_jobs;
drop policy if exists pos_ai_jobs_select on public.pos_ai_jobs;
create policy pos_ai_jobs_insert on public.pos_ai_jobs for insert to anon, authenticated
  with check (status = 'queued' and result is null and error is null);
create policy pos_ai_jobs_select on public.pos_ai_jobs for select to anon, authenticated using (true);

create or replace function public.pos_ai_jobs_kick() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare fn_url text;
begin
  select value into fn_url from public.pos_secrets where id = 'function_url';
  if fn_url is null then return new; end if;
  perform net.http_post(url := fn_url, body := jsonb_build_object('id', new.id),
    headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 10000);
  return new;
end $$;
revoke execute on function public.pos_ai_jobs_kick() from public, anon, authenticated;
drop trigger if exists pos_ai_jobs_kick on public.pos_ai_jobs;
create trigger pos_ai_jobs_kick after insert on public.pos_ai_jobs
  for each row when (new.status = 'queued') execute function public.pos_ai_jobs_kick();

-- AI spending guard: refuse jobs over 60 per device per 10 min, 300 per store per hour,
-- 1,000 per store per day, and photos over 6 MB. Normal use never reaches these.
create index if not exists pos_ai_jobs_created_idx on public.pos_ai_jobs (created_at);
create or replace function public.pos_ai_jobs_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare dev text := split_part(new.id, '_', 2); n_dev int; n_hour int; n_day int;
begin
  if new.image is not null and length(new.image) > 8000000 then
    raise exception 'AI limit: photo too large (max 6 MB). Take the photo again or use a smaller file.' using errcode = 'P0001';
  end if;
  if new.cats is not null and pg_column_size(new.cats) > 300000 then
    raise exception 'AI limit: request too large.' using errcode = 'P0001';
  end if;
  select count(*) into n_day  from public.pos_ai_jobs where created_at > now() - interval '1 day';
  if n_day >= 1000 then raise exception 'AI limit: 1,000 AI reads per day reached for this store. Try again tomorrow.' using errcode = 'P0001'; end if;
  select count(*) into n_hour from public.pos_ai_jobs where created_at > now() - interval '1 hour';
  if n_hour >= 300 then raise exception 'AI limit: 300 AI reads per hour reached for this store. Try again later.' using errcode = 'P0001'; end if;
  if dev <> '' then
    select count(*) into n_dev from public.pos_ai_jobs where created_at > now() - interval '10 minutes' and split_part(id, '_', 2) = dev;
    if n_dev >= 60 then raise exception 'AI limit: too many AI reads from this device. Wait 10 minutes.' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.pos_ai_jobs_limit() from public, anon, authenticated;
drop trigger if exists pos_ai_jobs_limit on public.pos_ai_jobs;
create trigger pos_ai_jobs_limit before insert on public.pos_ai_jobs
  for each row execute function public.pos_ai_jobs_limit();

-- >>> ONE LINE TO EDIT: put THIS project's reference (Project Settings → General → Reference ID).
insert into public.pos_secrets (id, value)
values ('function_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/read-receipt')
on conflict (id) do nothing;
-- Then: Edge Functions → Deploy new function → name "read-receipt" → paste supabase/read-receipt/index.ts
--       → turn OFF "Verify JWT" → Deploy. Edge Functions → Secrets → add ANTHROPIC_API_KEY (the store's own key).
-- Optional backup reader: insert into public.pos_secrets (id, value) values ('gemini', '<Google AI key>');

-- ---------- 6. Reporting views (dashboard / Sheets / Looker Studio) ----------
create or replace view public.v_sales with (security_invoker = true) as
  select id, data->>'no' as sale_no, to_timestamp((data->>'ts')::bigint/1000) as sold_at,
         data->>'branch' as branch_id, data->>'cashier' as cashier, data->>'pay' as payment,
         (data->>'total')::numeric as total, (data->>'void')::boolean as is_void
  from public.pos_records where kind = 'sale';

create or replace view public.v_stock with (security_invoker = true) as
  select data->>'branch' as branch_id, data->>'pid' as product_id,
         sum((data->>'qty')::numeric) as qty
  from public.pos_records where kind = 'move'
  group by 1, 2;
