create extension if not exists vector with schema extensions;

create table if not exists public.resources (
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_key text not null,
  canonical_url text not null,
  url text not null,
  title text not null,
  user_note text not null default '',
  summary text not null default '',
  tags text[] not null default '{}',
  topics text[] not null default '{}',
  content_excerpt text not null default '',
  content_hash text not null default '',
  selected_text text not null default '',
  author text not null default '',
  site_name text not null default '',
  language text not null default '',
  image_url text not null default '',
  favicon_url text not null default '',
  native_folder_path text[] not null default '{}',
  ai_status text not null default 'not_requested'
    check (
      ai_status in (
        'not_requested',
        'pending',
        'processing',
        'ready',
        'failed',
        'unavailable'
      )
    ),
  ai_metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, resource_key)
);

create index if not exists resources_user_updated_idx
  on public.resources (user_id, updated_at desc);

create index if not exists resources_user_canonical_url_idx
  on public.resources (user_id, canonical_url);

create index if not exists resources_embedding_hnsw_idx
  on public.resources
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.resources enable row level security;

create policy "Users can read their own resources"
  on public.resources
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own resources"
  on public.resources
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own resources"
  on public.resources
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own resources"
  on public.resources
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_resources_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists resources_set_updated_at on public.resources;
create trigger resources_set_updated_at
before update on public.resources
for each row
execute function public.set_resources_updated_at();

create or replace function public.match_resources(
  query_embedding extensions.vector(768),
  match_threshold double precision default 0.28,
  match_count integer default 20
)
returns table (
  resource_key text,
  canonical_url text,
  url text,
  title text,
  user_note text,
  summary text,
  tags text[],
  topics text[],
  content_excerpt text,
  content_hash text,
  selected_text text,
  author text,
  site_name text,
  language text,
  image_url text,
  favicon_url text,
  native_folder_path text[],
  ai_status text,
  created_at timestamptz,
  updated_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    resources.resource_key,
    resources.canonical_url,
    resources.url,
    resources.title,
    resources.user_note,
    resources.summary,
    resources.tags,
    resources.topics,
    resources.content_excerpt,
    resources.content_hash,
    resources.selected_text,
    resources.author,
    resources.site_name,
    resources.language,
    resources.image_url,
    resources.favicon_url,
    resources.native_folder_path,
    resources.ai_status,
    resources.created_at,
    resources.updated_at,
    1 - (resources.embedding <=> query_embedding) as similarity
  from public.resources
  where
    resources.user_id = (select auth.uid())
    and resources.embedding is not null
    and 1 - (resources.embedding <=> query_embedding) >= match_threshold
  order by resources.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;

grant execute on function public.match_resources(
  extensions.vector,
  double precision,
  integer
) to authenticated;
