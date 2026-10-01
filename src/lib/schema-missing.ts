// A read that names a table, column or join a migration adds, run before
// that migration is applied: Postgres says "undefined column/table"
// (42703, 42P01) and PostgREST says it can't find the relationship, column
// or table in its schema cache (PGRST200, PGRST204, PGRST205). Pages that
// read the new parts fall back to what they showed before instead of
// failing.
export function schemaMissing(e: { code?: string | null } | null | undefined): boolean {
  return !!e && ["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(e.code ?? "");
}
