-- Metadata only. Note text, workbook values, formulas and evidence remain on the device.
create table public.workbook_versions (
  user_id uuid not null default auth.uid() references auth.users(id),
  workbook_sha256 text not null check (workbook_sha256 ~ '^[0-9a-f]{64}$'),
  lineage_id uuid not null,
  linked_from_sha256 text null check (linked_from_sha256 is null or linked_from_sha256 ~ '^[0-9a-f]{64}$'),
  display_name text not null check (length(display_name) <= 255),
  created_at timestamptz not null default now(),
  insertion_order bigint generated always as identity,
  primary key (user_id, workbook_sha256),
  foreign key (user_id, linked_from_sha256) references public.workbook_versions(user_id, workbook_sha256),
  check (linked_from_sha256 is null or linked_from_sha256 <> workbook_sha256)
);
create table public.rulings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid unique not null,
  user_id uuid not null default auth.uid() references auth.users(id),
  workbook_sha256 text not null check (workbook_sha256 ~ '^[0-9a-f]{64}$'),
  lineage_id uuid not null,
  rule_id text not null check (rule_id in ('ERROR_VALUE', 'BROKEN_REF', 'FORMULA_DRIFT', 'CONSTANT_PLUG', 'SUM_RANGE_SHORT', 'MIXED_UNITS')),
  sheet text not null check (length(sheet) > 0),
  cell text not null check (cell ~ '^[A-Z]{1,3}[1-9][0-9]{0,6}$'),
  formula_hash text not null check (formula_hash ~ '^v1:[0-9a-f]{64}$'),
  decision text not null check (decision in ('confirm', 'dismiss', 'by_design')),
  has_note boolean not null default false,
  created_at timestamptz not null default now(),
  insertion_order bigint generated always as identity,
  foreign key (user_id, workbook_sha256) references public.workbook_versions(user_id, workbook_sha256)
);

alter table public.workbook_versions enable row level security;
alter table public.rulings enable row level security;
revoke all on table public.workbook_versions, public.rulings from public, anon, authenticated;
grant select, insert on table public.workbook_versions, public.rulings to authenticated;
grant usage on sequence public.workbook_versions_insertion_order_seq, public.rulings_insertion_order_seq to authenticated;

create policy workbook_versions_select_own on public.workbook_versions
  for select to authenticated using (user_id = auth.uid());
create policy workbook_versions_insert_own on public.workbook_versions
  for insert to authenticated with check (
    user_id = auth.uid() and (
      linked_from_sha256 is null or exists (
        select 1 from public.workbook_versions as target
        where target.user_id = auth.uid()
          and target.workbook_sha256 = workbook_versions.linked_from_sha256
          and target.lineage_id = workbook_versions.lineage_id
      )
    )
  );
create policy rulings_select_own on public.rulings
  for select to authenticated using (user_id = auth.uid());
create policy rulings_insert_own on public.rulings
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.workbook_versions as version
      where version.user_id = auth.uid()
        and version.workbook_sha256 = rulings.workbook_sha256
        and version.lineage_id = rulings.lineage_id
    )
  );
-- No UPDATE or DELETE policies/grants: lineage links and event records are immutable to clients.
create index workbook_versions_owner_lineage on public.workbook_versions(user_id, lineage_id);
create index rulings_owner_workbook on public.rulings(user_id, workbook_sha256, insertion_order);
create index rulings_owner_lineage on public.rulings(user_id, lineage_id, insertion_order);
