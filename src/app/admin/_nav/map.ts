import { hasAdminAccess, hasManagerAccess } from "@/lib/auth";
import type { BadgeKey } from "@/lib/data/backoffice";
import { weekStartOf } from "@/lib/data/team";
import { businessDay, shiftDate } from "@/lib/ops/time";
import type { EmployeeRole } from "@/lib/types";
import { AREAS, type AreaKey } from "./areas";

// The back office map: every page, in the area it belongs to. The sidebar,
// the phone menu, the dashboard's quick links and "Find anything" all read
// this one list, so a new page goes in here once and shows up everywhere.
//
// `min` only hides links that would bounce someone. It is never the
// security: every page and every action checks the role itself
// (src/lib/auth.ts), exactly as strictly as before.

type Access = "staff" | "manager" | "admin" | "owner";

export interface NavLink {
  href: string;
  label: string;
  about: string; // one plain line: what you do there
  keywords?: string; // other words people might type into Find anything
  badge?: BadgeKey;
}

interface MapLink extends NavLink {
  min?: Access;
}

export interface NavGroup {
  area: AreaKey;
  label: string;
  links: NavLink[];
}

export interface FindEntry extends NavLink {
  group: string; // the area (or "You") it's listed under
  area?: AreaKey;
}

export interface BackOfficeNav {
  home: NavLink;
  register: NavLink;
  groups: NavGroup[];
  you: NavLink[];
  find: FindEntry[];
}

const HOME: NavLink = { href: "/admin", label: "Today", about: "Your shortcuts, tonight at a glance, and anything that needs a look.", keywords: "dashboard home overview shortcuts" };

const REGISTER: NavLink = {
  href: "/pos",
  label: "Open the register",
  about: "Ring up orders, tabs and tickets.",
  keywords: "pos point of sale register tabs held orders checkout",
  badge: "tabs",
};

const PAGES: Record<AreaKey, MapLink[]> = {
  shows: [
    {
      href: "/admin/screenings",
      label: "Showtimes",
      about: "Movies, showings and tickets sold, plus house events like trivia.",
      keywords: "screenings movies films showings schedule a showing tmdb posters movie library house events trivia comedy book swap",
    },
    { href: "/admin/events", label: "Private events", about: "Party and venue bookings, deposits and what's still owed.", keywords: "event bookings rentals parties deposit balance venue" },
    { href: "/admin/booths", label: "Booths", about: "Lounge booth reservations, the calendar, and each booth's fee.", keywords: "booth reservations lounge calendar" },
    {
      href: "/admin/schedule-graphic",
      label: "Weekly flyer",
      about: "Make the week's lineup image for email and social posts.",
      keywords: "schedule graphic image instagram facebook promo canva lineup download",
    },
  ],
  guests: [
    {
      href: "/admin/members",
      label: "Members",
      about: "Find, add and edit members, points, Insiders+ and free memberships.",
      keywords: "insiders plus loyalty points customers guests add a member community programs free comped gift billing",
    },
    {
      href: "/admin/members/former-unlimited",
      label: "Former unlimited members",
      about: "Paid for unlimited on the old website: who's set up on Insiders+ here, who came in without paying, who hasn't been in.",
      keywords: "legacy old site unlimited monthly members insiders plus no card on file fortis onboarding set up",
      min: "manager",
    },
    { href: "/admin/members/regulars", label: "Top regulars", about: "Who came in most and spent most this month, for prizes.", keywords: "prizes visits spend leaderboard", min: "manager" },
    {
      href: "/admin/members/regulars/most-regular",
      label: "Most regular regulars",
      about: "All time: who comes in on the most days, and the most weeks in a row.",
      keywords: "streak weeks in a row loyal all time debate leaderboard regular",
      min: "manager",
    },
    {
      href: "/admin/members/past-purchases",
      label: "Points from past card purchases",
      about: "Rewind: find a regular's visits from before the new system and give them the points. Owners and admins also review every match and grant.",
      keywords: "rewind fortis backfill old card machine history points grant regulars past visits last 4 bank app tap",
      min: "manager",
    },
    {
      href: "/admin/email",
      label: "Email",
      about: "Member emails: the weekly lineup, campaigns, automations and results.",
      keywords: "email marketing newsletter campaign lineup automations unsubscribe suppressions resend insiders",
      min: "manager",
    },
    {
      href: "/admin/email/ready",
      label: "Ready to send",
      about: "Three finished member emails (the new Royale, Come in, Press play): preview, test and send them, and see who signed up.",
      keywords: "email invite send claim password new royale come in press play unlimited restart insiders ready test",
      min: "manager",
    },
    {
      href: "/admin/roadmap",
      label: "Roadmap & What's new",
      about: "What's shipped, being built and next in line on the public What's new page, plus the suggestions inbox.",
      keywords: "roadmap whats new what's new changelog queue ideas suggestions requests votes features shipped release version",
      min: "manager",
      badge: "roadmap",
    },
    {
      href: "/admin/members/old-site",
      label: "Old site members",
      about: "Check accounts from the old website before they're copied in.",
      keywords: "legacy import wordpress bots old website",
      min: "admin",
      badge: "oldSite",
    },
  ],
  stock: [
    {
      href: "/admin/menu",
      label: "Menu",
      about: "Items, prices, recipes and choices. Anything marked out shows here.",
      keywords: "prices items food drinks recipes modifiers 86 out ran out hide categories",
      badge: "itemsOut",
    },
    { href: "/admin/ingredients", label: "Ingredients & counts", about: "The ingredients recipes use, their costs, and shelf counts.", keywords: "inventory stock par counts cost pour", min: "manager" },
  ],
  team: [
    { href: "/admin/team", label: "Schedule", about: "Who's working when, week by week.", keywords: "shifts roster week staff schedule", min: "manager" },
    {
      href: "/admin/team?view=timesheets",
      label: "Hours & timesheets",
      about: "Hours worked from clock-ins, against the schedule. Late and missed shifts.",
      keywords: "hours clock in clocked timesheet payroll overtime late missed worked",
      min: "manager",
    },
    { href: "/admin/team?view=todos", label: "To-dos", about: "Give someone a task. It shows on the register for them.", keywords: "tasks assign todo reminders", min: "manager" },
    { href: "/admin/training", label: "Training", about: "Assign trainings and see who's signed off.", keywords: "courses sign off quiz assign training", min: "manager" },
  ],
  money: [
    {
      href: "/admin/reports",
      label: "Reports",
      about: "Sales by day, week and month, and every other report.",
      keywords: "sales revenue day orders tips refunds trend order search",
    },
    { href: "/admin/reports/box-office", label: "Box office", about: "Admissions and ticket money per movie, for the distributors.", keywords: "distributors film rental admissions tickets print" },
    { href: "/admin/reports/tax", label: "Sales tax", about: "Tax collected, by month or quarter, for the Missouri return.", keywords: "missouri return quarter dor tax" },
  ],
  setup: [
    {
      href: "/admin/printers",
      label: "Printers",
      about: "Receipt and kitchen printers, and recent print jobs.",
      keywords: "receipt kitchen tickets epson print jobs offline",
      min: "manager",
      badge: "printersOffline",
    },
    {
      href: "/display",
      label: "Screens & TVs",
      about: "Pick what a tablet or TV shows: kitchen, bar, lobby, ramp.",
      keywords: "displays live displays kitchen bar customer screen kiosk ramp lobby box office signage tv",
    },
    { href: "/admin/staff", label: "Staff logins & access", about: "Who can sign in, and what each person can do.", keywords: "roles admin manager cashier accounts permissions logins", min: "owner" },
    { href: "/admin/dev-notes", label: "Dev notes", about: "Notes about the site to review and hand to Claude.", keywords: "feedback bugs backlog claude dev notes", min: "admin", badge: "devNotes" },
  ],
};

const YOU: MapLink[] = [
  {
    href: "/admin/me",
    label: "My account",
    about: "Your shifts, hours this pay period, tasks done, what's coming up, and what you rang.",
    keywords: "me profile employee account analytics clock in clock out tasks calendar sales tips rang schedule",
  },
  { href: "/admin/my-hours", label: "My hours", about: "Your hours this week and in past weeks.", keywords: "hours worked clock in timesheet paycheck" },
  { href: "/admin/my-pin", label: "My PIN", about: "Change the PIN you type on the register.", keywords: "pin password code approve refunds", badge: "pin" },
  { href: "/training", label: "My training", about: "The trainings assigned to you.", keywords: "training courses sign off" },
  { href: "/help", label: "Help & FAQ", about: "How things work, in plain words.", keywords: "help faq how do i questions" },
  { href: "/", label: "View the website", about: "The public site, the way customers see it.", keywords: "public site home page customers" },
];

// More things Find anything can jump to: the other reports, the screens,
// and a few common jobs that live inside a page.
function shortcuts(dates: { yesterday: string; lastWeek: string }): (MapLink & { area: AreaKey })[] {
  return [
    { area: "money", href: `/admin/reports?date=${dates.yesterday}`, label: "Yesterday's sales", about: "Reports → Day, for yesterday.", keywords: "last night sales report" },
    { area: "money", href: "/admin/reports/week", label: "Week report", about: "Reports → Week: Monday to Sunday.", keywords: "weekly sales" },
    { area: "money", href: "/admin/reports/month", label: "Month report", about: "Reports → Month.", keywords: "monthly sales" },
    { area: "money", href: "/admin/reports/bar", label: "Bar usage", about: "Reports → Bar usage: pour cost, and poured against counted.", keywords: "pour cost overpour waste alcohol liquor" },
    { area: "money", href: "/admin/reports/members", label: "Members report", about: "Reports → Members: who our members are, free members by program.", keywords: "grant impact community analytics" },
    { area: "money", href: "/admin/reports/usage", label: "Website usage", about: "Reports → Website usage: visits to the public site.", keywords: "analytics traffic visitors page views site" },
    { area: "money", href: "/admin/reports/daily", label: "Daily email", about: "Preview the end-of-day email the owners get each morning.", keywords: "digest morning email report send" },
    { area: "guests", href: "/admin/members", label: "Add a member", about: "Members → + Add member.", keywords: "new member sign up join" },
    { area: "guests", href: "/admin/members?comped=1", label: "Free & community members", about: "Members, showing only the free ones.", keywords: "comped community programs grant" },
    {
      area: "team",
      href: `/admin/team?view=timesheets&week=${dates.lastWeek}`,
      label: "Last week's hours",
      about: "Hours & timesheets for last week.",
      keywords: "payroll timesheet last week",
      min: "manager",
    },
    { area: "setup", href: "/display/prep", label: "Kitchen & bar screen", about: "Every food and drink ticket on one screen.", keywords: "display prep tickets" },
    { area: "setup", href: "/display/kitchen", label: "Kitchen screen", about: "Food tickets to make.", keywords: "display prep" },
    { area: "setup", href: "/display/bar", label: "Bar screen", about: "Drink tickets to make.", keywords: "display prep" },
    { area: "setup", href: "/display/customer", label: "Customer screen", about: "The tablet facing the guest: lineup, check-in, their order.", keywords: "kiosk check in display" },
    { area: "setup", href: "/display/box-office", label: "Lobby showtimes board", about: "The public showtimes sign.", keywords: "box office signage display tv" },
    { area: "setup", href: "/display/ramp", label: "Ramp TV", about: "Big poster and countdown to the next film.", keywords: "portrait countdown display tv" },
  ];
}

function allowed(min: Access | undefined, role: EmployeeRole): boolean {
  if (!min || min === "staff") return true;
  if (min === "manager") return hasManagerAccess(role);
  if (min === "admin") return hasAdminAccess(role);
  return role === "owner";
}

function strip({ href, label, about, keywords, badge }: MapLink): NavLink {
  return { href, label, about, keywords, badge };
}

// What this person sees. An area with nothing in it for them is left out.
export function navFor(role: EmployeeRole): BackOfficeNav {
  const today = businessDay().date;
  const dates = { yesterday: shiftDate(today, -1), lastWeek: shiftDate(weekStartOf(today), -7) };
  const groups: NavGroup[] = AREAS.map((a) => ({ area: a.key, label: a.label, links: PAGES[a.key].filter((l) => allowed(l.min, role)).map(strip) })).filter(
    (g) => g.links.length > 0
  );
  const you = YOU.filter((l) => allowed(l.min, role)).map(strip);
  const find: FindEntry[] = [
    { ...HOME, group: "Today" },
    { ...REGISTER, group: "Today" },
    ...groups.flatMap((g) => g.links.map((l) => ({ ...l, group: g.label, area: g.area }))),
    ...shortcuts(dates)
      .filter((s) => allowed(s.min, role))
      .map((s) => ({ ...strip(s), group: AREAS.find((a) => a.key === s.area)!.label, area: s.area })),
    ...you.map((l) => ({ ...l, group: "You" })),
  ];
  return { home: HOME, register: REGISTER, groups, you, find };
}
