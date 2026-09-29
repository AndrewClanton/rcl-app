import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { TRAININGS, type TrainingCategory, type TrainingModule } from "@/lib/training/catalog";

// Where each person stands on each training:
// - new: assigned, never opened
// - started: opened, not signed off
// - done: signed off on the current version
// - update: signed off on an older version; the training changed since
export type TrainingState = "new" | "started" | "done" | "update";

export interface TrainingStatus {
  slug: string;
  title: string;
  summary: string;
  category: TrainingCategory;
  minutes: number;
  hasQuiz: boolean;
  assigned: boolean;
  assignmentId: string | null;
  dueDate: string | null;
  overdue: boolean;
  note: string | null;
  state: TrainingState | null; // null: not assigned and never signed
  completedAt: string | null;
  via: "register" | "phone" | null;
}

interface AssignmentRow {
  id: string;
  employee_id: string;
  module_slug: string;
  due_date: string | null;
  note: string | null;
  first_opened_at: string | null;
}
interface CompletionRow {
  employee_id: string;
  module_slug: string;
  module_version: number;
  completed_at: string;
  via: "register" | "phone";
}

function statusOf(t: TrainingModule, a: AssignmentRow | undefined, c: CompletionRow | undefined, today: string): TrainingStatus {
  const state: TrainingState | null = c ? (c.module_version >= t.version ? "done" : "update") : a ? (a.first_opened_at ? "started" : "new") : null;
  return {
    slug: t.slug,
    title: t.title,
    summary: t.summary,
    category: t.category,
    minutes: t.minutes,
    hasQuiz: !!t.quiz,
    assigned: !!a,
    assignmentId: a?.id ?? null,
    dueDate: a?.due_date ?? null,
    overdue: !!a?.due_date && state !== "done" && a.due_date < today,
    note: a?.note ?? null,
    state,
    completedAt: c?.completed_at ?? null,
    via: c?.via ?? null,
  };
}

// Latest sign-off per (person, training).
function latestBy(rows: CompletionRow[]) {
  const m = new Map<string, CompletionRow>();
  for (const r of rows) {
    const k = `${r.employee_id}:${r.module_slug}`;
    const had = m.get(k);
    if (!had || r.completed_at > had.completed_at) m.set(k, r);
  }
  return m;
}

async function load(employeeIds: string[] | null) {
  const supabase = createAdminClient();
  let aq = supabase.from("training_assignments").select("id, employee_id, module_slug, due_date, note, first_opened_at");
  let cq = supabase.from("training_completions").select("employee_id, module_slug, module_version, completed_at, via");
  if (employeeIds) {
    aq = aq.in("employee_id", employeeIds);
    cq = cq.in("employee_id", employeeIds);
  }
  const [a, c] = await Promise.all([aq, cq]);
  const assignments = new Map(((a.data ?? []) as AssignmentRow[]).map((r) => [`${r.employee_id}:${r.module_slug}`, r]));
  return { assignments, completions: latestBy((c.data ?? []) as CompletionRow[]) };
}

// One person's trainings: everything in the catalog, assigned ones first.
export async function getTrainingFor(employeeId: string): Promise<TrainingStatus[]> {
  const { assignments, completions } = await load([employeeId]);
  const today = businessDay().date;
  return TRAININGS.map((t) => statusOf(t, assignments.get(`${employeeId}:${t.slug}`), completions.get(`${employeeId}:${t.slug}`), today));
}

export interface StaffRow {
  id: string;
  name: string;
  role: string;
}

export async function activeStaff(): Promise<StaffRow[]> {
  const { data } = await createAdminClient().from("employees").select("id, name, role").eq("active", true).neq("role", "display").order("name");
  return (data ?? []) as StaffRow[];
}

// For managers: every training, with where each active person stands.
export async function getTrainingOverview(): Promise<{ staff: StaffRow[]; modules: (TrainingModule & { people: (TrainingStatus & { employeeId: string; name: string })[] })[] }> {
  const staff = await activeStaff();
  const { assignments, completions } = await load(staff.map((p) => p.id));
  const today = businessDay().date;
  return {
    staff,
    modules: TRAININGS.map((t) => ({
      ...t,
      people: staff.map((p) => ({ ...statusOf(t, assignments.get(`${p.id}:${t.slug}`), completions.get(`${p.id}:${t.slug}`), today), employeeId: p.id, name: p.name })),
    })),
  };
}

// What the people on shift still have to do, for the register's shift bar.
export async function trainingDueFor(employeeIds: string[]): Promise<{ employeeId: string; slug: string; title: string; dueDate: string | null; overdue: boolean; state: TrainingState }[]> {
  if (employeeIds.length === 0) return [];
  const { assignments, completions } = await load(employeeIds);
  const today = businessDay().date;
  const out: { employeeId: string; slug: string; title: string; dueDate: string | null; overdue: boolean; state: TrainingState }[] = [];
  for (const a of assignments.values()) {
    const t = TRAININGS.find((m) => m.slug === a.module_slug);
    if (!t) continue;
    const st = statusOf(t, a, completions.get(`${a.employee_id}:${t.slug}`), today);
    if (st.state && st.state !== "done") out.push({ employeeId: a.employee_id, slug: t.slug, title: t.title, dueDate: st.dueDate, overdue: st.overdue, state: st.state });
  }
  return out.sort((x, y) => (x.dueDate ?? "9999").localeCompare(y.dueDate ?? "9999"));
}
