
-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text default '',
  avatar_url text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  slug text unique not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
alter table public.organizations enable row level security;
create policy "Anyone can view orgs" on public.organizations for select using (true);
create policy "Auth users create orgs" on public.organizations for insert to authenticated with check (auth.uid() = created_by);
create policy "Owners update orgs" on public.organizations for update to authenticated using (auth.uid() = created_by);
create policy "Owners delete orgs" on public.organizations for delete to authenticated using (auth.uid() = created_by);

-- Categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  organization_id uuid references public.organizations(id) on delete cascade not null,
  created_at timestamptz default now()
);
alter table public.categories enable row level security;
create policy "Org owners manage categories" on public.categories for all to authenticated
  using (exists (select 1 from public.organizations where id = organization_id and created_by = auth.uid()));
create policy "Public view categories" on public.categories for select using (true);

-- Topics
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  category_id uuid references public.categories(id) on delete set null,
  type text not null default 'processo',
  level text not null default 'básico',
  organization_id uuid references public.organizations(id) on delete cascade not null,
  created_at timestamptz default now()
);
alter table public.topics enable row level security;
create policy "Org owners manage topics" on public.topics for all to authenticated
  using (exists (select 1 from public.organizations where id = organization_id and created_by = auth.uid()));

-- Flows
create table public.flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  created_at timestamptz default now()
);
alter table public.flows enable row level security;
create policy "Org owners manage flows" on public.flows for all to authenticated
  using (exists (select 1 from public.organizations where id = organization_id and created_by = auth.uid()));

-- Flow Steps
create table public.flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid references public.flows(id) on delete cascade not null,
  title text not null,
  description text default '',
  action text default '',
  responsible text default '',
  step_order integer not null default 0,
  next_step_id uuid references public.flow_steps(id) on delete set null,
  conditions jsonb,
  created_at timestamptz default now()
);
alter table public.flow_steps enable row level security;
create policy "Org owners manage flow steps" on public.flow_steps for all to authenticated
  using (exists (
    select 1 from public.flows f join public.organizations o on o.id = f.organization_id
    where f.id = flow_id and o.created_by = auth.uid()
  ));

-- Knowledge Base
create table public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  title text not null,
  file_url text,
  file_type text,
  content text default '',
  created_at timestamptz default now()
);
alter table public.knowledge_base enable row level security;
create policy "Org owners manage knowledge" on public.knowledge_base for all to authenticated
  using (exists (select 1 from public.organizations where id = organization_id and created_by = auth.uid()));

-- Support Contacts
create table public.support_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  email text default '',
  phone text default '',
  created_at timestamptz default now()
);
alter table public.support_contacts enable row level security;
create policy "Org owners manage contacts" on public.support_contacts for all to authenticated
  using (exists (select 1 from public.organizations where id = organization_id and created_by = auth.uid()));

-- Storage bucket for knowledge base files
insert into storage.buckets (id, name, public) values ('knowledge-files', 'knowledge-files', true);

create policy "Auth users upload knowledge files" on storage.objects
  for insert to authenticated with check (bucket_id = 'knowledge-files');
create policy "Anyone read knowledge files" on storage.objects
  for select using (bucket_id = 'knowledge-files');
create policy "Auth users delete knowledge files" on storage.objects
  for delete to authenticated using (bucket_id = 'knowledge-files');
