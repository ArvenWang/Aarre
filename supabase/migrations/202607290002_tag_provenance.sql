alter table public.resources
  add column if not exists tags_source text not null default 'ai'
  check (tags_source in ('ai', 'user'));
