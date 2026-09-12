create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique, description text, created_at timestamptz not null default now()
);
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(), slug text not null unique, title text not null, description text not null default '', category_id uuid references public.categories(id) on delete set null,
  tags text[] not null default '{}', software text[] not null default '{}', version text, file_name text not null, file_key text not null unique, file_size bigint not null default 0, mime_type text not null default 'application/octet-stream', thumbnail_url text, preview_url text, license text,
  featured boolean not null default false, published boolean not null default false, downloads bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists resources_published_created_idx on public.resources(published, created_at desc);
create index if not exists resources_category_idx on public.resources(category_id);
create table if not exists public.downloads (
  id bigint generated always as identity primary key, resource_id uuid not null references public.resources(id) on delete cascade, user_id uuid references auth.users(id) on delete set null, ip_hash text, user_agent text, created_at timestamptz not null default now()
);
create index if not exists downloads_resource_idx on public.downloads(resource_id, created_at desc);
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade, resource_id uuid not null references public.resources(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id, resource_id)
);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, display_name text, created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.resources enable row level security;
alter table public.downloads enable row level security;
alter table public.favorites enable row level security;
alter table public.profiles enable row level security;

drop policy if exists public_categories_read on public.categories;
create policy public_categories_read on public.categories for select using (true);
drop policy if exists public_resources_read on public.resources;
create policy public_resources_read on public.resources for select using (published = true);
drop policy if exists own_favorites_read on public.favorites;
create policy own_favorites_read on public.favorites for select using (auth.uid() = user_id);
drop policy if exists own_favorites_insert on public.favorites;
create policy own_favorites_insert on public.favorites for insert with check (auth.uid() = user_id);
drop policy if exists own_favorites_delete on public.favorites;
create policy own_favorites_delete on public.favorites for delete using (auth.uid() = user_id);
drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

insert into public.categories(name,slug,description) values
('Scenepacks','scenepacks','Ready-to-use movie, anime and cinematic scenes.'),
('Presets','presets','Editing presets for your favourite workflows.'),
('LUTs','luts','Colour grades and cinematic LUTs.'),
('VFX','vfx','Visual effects, particles and compositing assets.'),
('Sound Effects','sound-effects','Impacts, whooshes, ambience and more.'),
('After Effects','after-effects','Scripts, extensions and AE tools.'),
('Overlays','overlays','Textures, light leaks, particles and overlays.'),
('Tutorials','tutorials','Practical editing guides and workflows.'),
('Project Files','project-files','Starter projects and editable examples.'),
('Fonts','fonts','Typefaces for motion and video design.')
on conflict (slug) do nothing;

create or replace function public.bump_download_count(resource uuid) returns void language sql security definer set search_path=public as $$
  update public.resources set downloads = downloads + 1, updated_at = now() where id = resource;
$$;
