-- Préparation J7 : à appliquer et tester dans un projet Supabase de développement.
-- Aucune base n'a été créée ni migrée par le développement local.
begin;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  created_at timestamptz not null default now()
);
create table public.company_memberships (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  primary key (company_id, user_id)
);
create index memberships_user_idx on public.company_memberships(user_id, company_id);
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  sector text not null check (char_length(sector) between 2 and 160),
  city text not null check (char_length(city) between 2 and 160),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  prospect_id uuid not null,
  title text not null check (char_length(title) between 2 and 160),
  description text not null check (char_length(description) between 5 and 4000),
  project_type text not null default '' check (char_length(project_type) <= 200),
  city text not null default '' check (char_length(city) <= 200),
  budget numeric(14,2) not null default 0 check (budget between 0 and 1000000000),
  requested_timeline text not null default '' check (char_length(requested_timeline) <= 200),
  status text not null default 'nouvelle' check (status in ('nouvelle','a_qualifier','qualifiee','en_cours','gagnee','perdue')),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, prospect_id) references public.prospects(company_id, id) on delete restrict
);
create table public.followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null,
  title text not null check (char_length(title) between 2 and 160),
  due_date date not null,
  done boolean not null default false,
  foreign key (company_id, request_id) references public.quote_requests(company_id, id) on delete cascade
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null,
  title text not null check (char_length(title) between 2 and 160),
  starts_at timestamptz not null,
  duration_minutes int not null check (duration_minutes between 15 and 240),
  foreign key (company_id, request_id) references public.quote_requests(company_id, id) on delete cascade
);
create index prospects_company_idx on public.prospects(company_id);
create index requests_company_idx on public.quote_requests(company_id, created_at desc);
create index followups_company_idx on public.followups(company_id, due_date);
create index appointments_company_idx on public.appointments(company_id, starts_at);

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.prospects enable row level security;
alter table public.quote_requests enable row level security;
alter table public.followups enable row level security;
alter table public.appointments enable row level security;

-- Aucune écriture des adhésions ou entreprises par un utilisateur connecté.
-- Provisionner l'entreprise et ses membres par un processus administrateur autorisé séparé.
create policy memberships_read_own on public.company_memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy companies_read_member on public.companies for select to authenticated
  using (id in (select company_id from public.company_memberships where user_id = (select auth.uid())));

create policy prospects_member on public.prospects for all to authenticated
  using (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())))
  with check (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())));
create policy requests_member on public.quote_requests for all to authenticated
  using (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())))
  with check (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())));
create policy followups_member on public.followups for all to authenticated
  using (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())))
  with check (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())));
create policy appointments_member on public.appointments for all to authenticated
  using (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())))
  with check (company_id in (select company_id from public.company_memberships where user_id = (select auth.uid())));

-- Révoquer les privilèges éventuellement accordés par défaut par Supabase.
revoke all on public.companies, public.company_memberships, public.prospects, public.quote_requests, public.followups, public.appointments from anon, authenticated;
grant select on public.companies, public.company_memberships to authenticated;
grant select, insert, update, delete on public.prospects, public.quote_requests, public.followups, public.appointments to authenticated;
commit;
