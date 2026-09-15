// Turns a display name into a unique-enough key, e.g. for menu_categories.key.
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = Date.now().toString(36).slice(-6);
  return `${base || "item"}_${suffix}`;
}
