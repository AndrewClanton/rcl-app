-- Print queue: the website holds each print job until the printer that
-- should print it comes and asks. Epson printers with Server Direct Print
-- (TM-m30II-H / TM-m30III) poll /api/print/poll on their own; the bar's
-- original TM-m30 has no SDP, so a Raspberry Pi next to it polls the same
-- way and passes jobs on over the local network (scripts/pi-print-relay).
-- No more browser-to-printer hop, so no printer certificate for the iPad to
-- keep re-accepting.
--
-- Additive and safe to run more than once. Server-only, like the rest: RLS
-- on, no client policies; only the service role (the app's server code)
-- reads or writes these.

-- ---------- printers ----------
-- One row per printer (or relay). login_id and the password are what's
-- typed into the printer's Server Direct Print settings; only hashes of the
-- password are kept: sha256 for HTTP Basic (the Pi relay) and the Digest
-- HA1, md5(login_id:realm:password), which is what Epson printers answer a
-- Digest challenge with. The realm is fixed in src/lib/print/printer-auth.ts.
--
-- What it prints: receipts etc. for one register station (receipt_station),
-- and/or the kitchen's order tickets. One active printer per job.
create table if not exists printers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  location text,
  kind text not null check (kind in ('sdp', 'relay')),
  login_id text not null unique check (login_id ~ '^[A-Za-z0-9_.-]{1,30}$'),
  secret_sha256 text not null,
  digest_ha1 text not null,
  receipt_station text check (receipt_station in ('bar', 'outdoor')),
  order_tickets boolean not null default false,
  active boolean not null default true,
  poll_interval_seconds int not null default 5 check (poll_interval_seconds between 1 and 600),
  last_seen_at timestamptz,
  reported_name text, -- the "Name" the printer sends, for spotting a mix-up
  poll_window_start timestamptz,
  poll_count int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null
);

create unique index if not exists printers_one_per_station on printers (receipt_station) where active and receipt_station is not null;
create unique index if not exists printers_one_kitchen on printers (order_tickets) where active and order_tickets;

alter table printers enable row level security;

-- ---------- print jobs ----------
-- The ePOS-Print XML body, built by the same code as always
-- (src/lib/print/receipt.ts). queued -> sent (handed to the printer) ->
-- printed | failed; queued -> expired when nobody picked it up in time
-- (receipts ~10 min, drawer kicks ~2 min, kitchen tickets ~60 min), so a
-- printer coming back online never pops a drawer or prints a receipt long
-- after the customer left. A failed attempt goes back to queued until
-- max_attempts. Jobs of a cancelled tab go with it (on delete cascade).
create table if not exists print_jobs (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  printer_id uuid not null references printers(id) on delete cascade,
  kind text not null check (kind in ('receipt', 'tickets', 'order_ticket', 'test', 'drawer', 'card')),
  label text,
  xml text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'printed', 'failed', 'expired', 'cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 4,
  created_at timestamptz not null default now(),
  not_before timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_at timestamptz,
  done_at timestamptz,
  error text,
  order_id uuid references orders(id) on delete cascade,
  created_by uuid references employees(id) on delete set null
);

create index if not exists print_jobs_queue_idx on print_jobs (printer_id, status, seq);
create index if not exists print_jobs_created_idx on print_jobs (created_at desc);
create index if not exists print_jobs_order_idx on print_jobs (order_id) where order_id is not null;

alter table print_jobs enable row level security;

-- ---------- kitchen order tickets ----------
-- What the kitchen has already been sent for an order, so a tab only
-- prints what was added since ("ADD-ON"), never the whole tab again.
-- sent: [{name, qty, mods}] already on a ticket (printed or queued).
-- pending_job_id/pending: a tab's newest ticket, held a few seconds while
-- the bartender is still ringing, so it can be replaced by one ticket with
-- everything instead of a ticket per tap. register_station: which register
-- (bar / outdoor) the order came from.
create table if not exists order_ticket_state (
  order_id uuid primary key references orders(id) on delete cascade,
  register_station text check (register_station in ('bar', 'outdoor')),
  sent jsonb not null default '[]'::jsonb,
  tickets int not null default 0,
  pending_job_id uuid references print_jobs(id) on delete set null,
  pending jsonb not null default '[]'::jsonb,
  pending_since timestamptz,
  updated_at timestamptz not null default now()
);

alter table order_ticket_state enable row level security;

-- ---------- what the poll endpoint calls ----------

-- One poll from a printer: note that it's alive, give up on its jobs that
-- are past their time, put back any it was handed but never answered
-- for, then hand it the next few (oldest first, up to p_max_bytes of XML
-- so the printer's buffer isn't overrun) and mark them sent. At most 120
-- polls a minute per printer; beyond that it's told to slow down.
create or replace function public.claim_print_jobs(p_printer uuid, p_max_jobs int default 5, p_max_bytes int default 500000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_total int := 0;
  v_jobs jsonb := '[]'::jsonb;
  j record;
begin
  update printers
     set last_seen_at = now(),
         poll_count = case when poll_window_start is null or poll_window_start < now() - interval '1 minute' then 1 else poll_count + 1 end,
         poll_window_start = case when poll_window_start is null or poll_window_start < now() - interval '1 minute' then now() else poll_window_start end
   where id = p_printer and active
  returning poll_count into v_count;
  if not found then
    return jsonb_build_object('status', 'inactive');
  end if;
  if v_count > 120 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  update print_jobs
     set status = 'expired', done_at = now(), error = coalesce(error, 'Not picked up in time')
   where printer_id = p_printer and status = 'queued' and expires_at <= now();

  update print_jobs
     set status = case when attempts < max_attempts and expires_at > now() then 'queued' else 'failed' end,
         done_at = case when attempts < max_attempts and expires_at > now() then null else now() end,
         error = 'The printer never said whether it printed'
   where printer_id = p_printer and status = 'sent' and sent_at < now() - interval '2 minutes';

  for j in
    select id, kind, xml, octet_length(xml) as n
      from print_jobs
     where printer_id = p_printer and status = 'queued' and not_before <= now() and expires_at > now()
     order by seq
     limit greatest(1, least(p_max_jobs, 20))
     for update skip locked
  loop
    exit when v_total > 0 and v_total + j.n > p_max_bytes;
    v_total := v_total + j.n;
    update print_jobs set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = j.id;
    v_jobs := v_jobs || jsonb_build_array(jsonb_build_object('id', j.id, 'kind', j.kind, 'xml', j.xml));
  end loop;

  return jsonb_build_object('status', 'ok', 'jobs', v_jobs);
end;
$$;

-- The printer's answer for jobs it was handed: [{id, ok, error, retry}].
-- Only this printer's jobs that are out being printed are touched. A
-- failure goes back in the queue (a little later each time) until it runs
-- out of attempts or time; retry=false (a job the printer can't read)
-- fails it straight away.
create or replace function public.finish_print_jobs(p_printer uuid, p_results jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_ok boolean;
  v_retry boolean;
  n int := 0;
  k int;
begin
  for r in select * from jsonb_array_elements(p_results)
  loop
    v_ok := coalesce((r->>'ok')::boolean, false);
    v_retry := coalesce((r->>'retry')::boolean, true);
    update print_jobs j
       set status = case when v_ok then 'printed'
                         when v_retry and j.attempts < j.max_attempts and j.expires_at > now() then 'queued'
                         else 'failed' end,
           done_at = case when v_ok or not (v_retry and j.attempts < j.max_attempts and j.expires_at > now()) then now() else null end,
           not_before = case when v_ok then j.not_before else now() + make_interval(secs => 15 * j.attempts) end,
           error = case when v_ok then null else left(coalesce(r->>'error', 'The printer couldn''t print it'), 300) end
     where j.id = (r->>'id')::uuid and j.printer_id = p_printer and j.status = 'sent';
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end;
$$;

-- Housekeeping for the Printers page: the same expiry and give-up rules as
-- a poll, for every printer (one that's switched off never polls), and
-- jobs older than two weeks deleted -- they hold customers' names.
create or replace function public.sweep_print_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update print_jobs
     set status = 'expired', done_at = now(), error = coalesce(error, 'Not picked up in time')
   where status = 'queued' and expires_at <= now();
  update print_jobs
     set status = case when attempts < max_attempts and expires_at > now() then 'queued' else 'failed' end,
         done_at = case when attempts < max_attempts and expires_at > now() then null else now() end,
         error = 'The printer never said whether it printed'
   where status = 'sent' and sent_at < now() - interval '2 minutes';
  delete from print_jobs where created_at < now() - interval '14 days';
end;
$$;

-- Server-only plumbing: Supabase grants new public functions to anon and
-- authenticated by default.
revoke execute on function public.claim_print_jobs(uuid, int, int) from public, anon, authenticated;
revoke execute on function public.finish_print_jobs(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.sweep_print_jobs() from public, anon, authenticated;
grant execute on function public.claim_print_jobs(uuid, int, int) to service_role;
grant execute on function public.finish_print_jobs(uuid, jsonb) to service_role;
grant execute on function public.sweep_print_jobs() to service_role;
