-- Why a register order went without sales tax, so Reports can say so
-- without anyone having to ask. Set when the "Tax exempt" box is ticked on
-- the register, which needs a manager PIN and a reason (src/lib/tax-exempt.ts):
--   tax_exempt_reason       certificate (a Missouri exemption certificate),
--                           courtesy (we covered the tax), or other
--   tax_exempt_note         the certificate number, or a short note for other
--   tax_exempt_marked_by    the cashier on the register who ticked it
--   tax_exempt_approved_by  the manager whose PIN approved it (null when two
--                           managers share a PIN and there's no telling who)
--   tax_exempt_at           when it was approved
-- Orders marked tax-free before this have none of these; Reports show who
-- rang them and "no reason recorded". Nothing existing is changed.
-- The register only writes these on tax-free orders, so every other sale
-- keeps saving even before this is applied.
alter table orders
  add column if not exists tax_exempt_reason text check (tax_exempt_reason in ('certificate', 'courtesy', 'other')),
  add column if not exists tax_exempt_note text check (char_length(tax_exempt_note) <= 200),
  add column if not exists tax_exempt_marked_by uuid references employees(id) on delete set null,
  add column if not exists tax_exempt_approved_by uuid references employees(id) on delete set null,
  add column if not exists tax_exempt_at timestamptz;
