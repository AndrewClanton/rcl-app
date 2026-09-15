import { getMenuTree } from "@/lib/data/menu";
import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const categories = await getMenuTree();
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <MenuManager categories={categories} />
    </div>
  );
}
