// The areas of the back office, grouped by the job, not by the database.
// Each has its own color (the .bo-area-* classes in globals.css) so people
// can tell where they are at a glance. Red, amber and green are left for
// status. Plain data with no server code, so the page header (which some
// browser-side screens use) can read it too; the pages in each area are in
// ./map.ts.

export type AreaKey = "shows" | "guests" | "stock" | "team" | "money" | "setup";

export interface Area {
  key: AreaKey;
  label: string;
}

export const AREAS: Area[] = [
  { key: "shows", label: "Shows & events" },
  { key: "guests", label: "Guests & members" },
  { key: "stock", label: "Menu & stock" },
  { key: "team", label: "Team" },
  { key: "money", label: "Money & reports" },
  { key: "setup", label: "Setup" },
];

export function areaLabel(key: AreaKey): string {
  return AREAS.find((a) => a.key === key)?.label ?? "";
}
