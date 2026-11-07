-- Tindero POS · Supabase setup (run once in Supabase → SQL Editor → New query → Run)
-- One table holds every record (products, sales, purchases, stock movements, users, branches, photos).
-- Stock is never overwritten: it is the sum of append-only movements, so devices can't clobber each other.

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

-- Last-write-wins: an older edit from an offline device never overwrites a newer one.
create or replace function public.pos_records_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.client_ts < old.client_ts then
    return old;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists pos_records_lww on public.pos_records;
create trigger pos_records_lww
  before insert or update on public.pos_records
  for each row execute function public.pos_records_lww();

-- Access: app uses the project's publishable/anon key.
-- Use ONE Supabase project per store/client and keep the URL+key private to your devices.
alter table public.pos_records enable row level security;
drop policy if exists pos_app_rw on public.pos_records;
create policy pos_app_rw on public.pos_records
  for all to anon, authenticated using (true) with check (true);

-- Handy views for reporting in the Supabase dashboard / Google Sheets / Looker Studio
create or replace view public.v_sales as
  select id, data->>'no' as sale_no, to_timestamp((data->>'ts')::bigint/1000) as sold_at,
         data->>'branch' as branch_id, data->>'cashier' as cashier, data->>'pay' as payment,
         (data->>'total')::numeric as total, (data->>'void')::boolean as is_void
  from public.pos_records where kind = 'sale';

create or replace view public.v_stock as
  select data->>'branch' as branch_id, data->>'pid' as product_id,
         sum((data->>'qty')::numeric) as qty
  from public.pos_records where kind = 'move'
  group by 1, 2;
