create extension if not exists pgcrypto;

create table if not exists public.mk_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.mk_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  object_path text not null unique,
  category_id uuid references public.mk_categories(id) on delete set null,
  video_type text not null default 'series',
  duration_seconds integer,
  file_size bigint,
  mime_type text not null default 'video/mp4',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.mk_schedule (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.mk_videos(id) on delete cascade,
  start_time time not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.mk_viewers (
  viewer_id text primary key,
  last_seen_at timestamptz not null default now()
);

insert into public.mk_categories(name,slug,sort_order) values
('Series','series',1),('Tandas','tandas',2),('Especiales','especiales',3),('Otros','otros',4)
on conflict (slug) do nothing;

create index if not exists mk_videos_category_idx on public.mk_videos(category_id);
create index if not exists mk_videos_created_idx on public.mk_videos(created_at desc);
create index if not exists mk_viewers_seen_idx on public.mk_viewers(last_seen_at);

alter table public.mk_categories enable row level security;
alter table public.mk_videos enable row level security;
alter table public.mk_schedule enable row level security;
alter table public.mk_viewers enable row level security;

create policy "public read categories" on public.mk_categories for select using (true);
create policy "public read videos" on public.mk_videos for select using (true);
create policy "public read schedule" on public.mk_schedule for select using (true);
create policy "public heartbeat" on public.mk_viewers for insert with check (true);
create policy "public refresh heartbeat" on public.mk_viewers for update using (true) with check (true);
