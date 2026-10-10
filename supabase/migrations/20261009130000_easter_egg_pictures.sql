-- Easter egg pictures (Andrew, 10/9): pictures an admin drops in under
-- Back office → Printers → Easter egg pictures, printed one at a time from
-- the register (✨ → 🎲 Print a meme) on the station's receipt printer.
--
-- 1. easter-eggs: a private Storage bucket for the uploaded pictures. No
--    policies, so no client can read or write it; only the service key
--    (the back office's server actions, the register's print action) does.
--    The back office shows thumbnails through short-lived signed URLs.
-- 2. easter_egg_pictures: one row per picture, with the printer-ready
--    1-bit raster cached on it (raster_*), made when it's uploaded (or the
--    first time it prints, if that failed), so a press doesn't redo it.
--    raster_version says which conversion made it; a newer one redoes it.
--
-- Server-only: RLS on, no client policies. Additive and safe to run twice.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('easter-eggs', 'easter-eggs', false, 8388608, array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.easter_egg_pictures (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  name text not null default '',
  content_type text not null,
  raster_width integer,
  raster_height integer,
  raster_data text,
  raster_version integer,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.easter_egg_pictures enable row level security;

grant select, insert, update, delete on public.easter_egg_pictures to service_role;
