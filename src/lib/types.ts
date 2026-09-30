import type { PictureCredit, PictureSource } from "./menu-pictures/shared";

export type ModifierType = "single" | "multi";
export type EventPriceMode = "deposit" | "full";
export type OrderSource = "pos" | "web";
export type OrderStatus = "draft" | "held" | "tab" | "completed" | "refunded" | "voided";
export type PaymentMethod = "cash" | "card" | "split";
// 'display' = an unattended signage login (e.g. the ramp TV), not a person.
// Treated as not-staff everywhere except its screens; see src/lib/auth.ts.
export type EmployeeRole = "cashier" | "manager" | "admin" | "owner" | "display";
export type MemberTier = "Insiders" | "Insiders+";
export type EventStatus = "outstanding" | "paid";
export type DevNoteStatus = "new" | "approved" | "dismissed" | "done";

export interface DevNoteComment {
  id: string;
  message: string;
  created_at: string;
  created_by: { name: string } | null;
}

export interface DevNote {
  id: string;
  page_path: string;
  page_title: string | null;
  message: string;
  status: DevNoteStatus;
  created_at: string;
  updated_at: string;
  submitted_by: { name: string } | null;
  comments: DevNoteComment[];
}

export interface ModifierOption {
  id: string;
  group_id: string;
  name: string;
  price_delta: number;
  sort_order: number;
}

export interface ModifierGroup {
  id: string;
  item_id: string;
  key: string;
  label: string;
  type: ModifierType;
  // A "choose one" group with no default: the register asks every time
  // (which soda comes with the $5 Special).
  must_choose?: boolean;
  sort_order: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  price: number;
  is_alcohol: boolean;
  is_event_item: boolean;
  event_price_mode: EventPriceMode | null;
  sort_order: number;
  active: boolean;
  // 86'd ("Ran out" on the register): set while it shouldn't be sold, with
  // the reason shown on its button ("Out of hot dog buns").
  out_since?: string | null;
  out_note?: string | null;
  out_outage_id?: string | null;
  // The picture on its register button: always a file in our public
  // "menu-photos" bucket (a photo someone took, or a free one the server
  // found and stored), else its label tile. Where it came from and its
  // credit: lib/menu-pictures/shared.ts (PictureState).
  image_url?: string | null;
  image_source?: PictureSource | null;
  image_credit?: PictureCredit | null;
  image_query?: string | null;
  image_index?: number | null;
  image_approved_at?: string | null;
  modifier_groups: ModifierGroup[];
}

export interface MenuCategory {
  id: string;
  key: string;
  label: string;
  parent_id: string | null;
  sort_order: number;
  // Small round photo on its register tab (or beside a subcategory heading).
  image_url?: string | null;
  image_source?: PictureSource | null;
  image_credit?: PictureCredit | null;
  image_query?: string | null;
  image_index?: number | null;
  image_approved_at?: string | null;
  items: MenuItem[];
  subcategories: MenuCategory[];
}

export type IngredientUnit = "oz" | "ml" | "count";

export interface Ingredient {
  id: string;
  name: string;
  unit: IngredientUnit;
  bottle_size: number | null;
  unit_cost: number | null;
  category: string | null;
  active: boolean;
  // The par sheet line it's bought from (Register → shift tools), if any.
  par_item_id: string | null;
}

// A par sheet line as the recipe editor and the Ingredients page see it
// (the register's own ParItem, in src/lib/ops/shared.ts, has the counts).
export interface ParItemRef {
  id: string;
  area: string;
  section: string | null;
  name: string;
  unit: string | null;
  source: string | null;
  active: boolean;
}

export interface RecipeIngredientLine {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: IngredientUnit;
  quantity: number;
  sort_order: number;
}

// Recipes are fetched separately from the public menu tree (see
// src/lib/data/recipes.ts) -- staff-only information, never joined onto the
// MenuItem shape that the public /menu page also renders.
export interface Recipe {
  id: string;
  menu_item_id: string;
  instructions: string | null;
  glassware: string | null;
  garnish: string | null;
  ingredients: RecipeIngredientLine[];
}

export interface RoomAddon {
  id: string;
  room_id: string;
  name: string;
  hourly_rate: number;
  sort_order: number;
}

export interface Room {
  id: string;
  key: string;
  name: string;
  capacity: number;
  is_screening_room: boolean;
  is_event_space: boolean;
  hourly_rate: number | null;
  cleaning_fee: number | null;
  addons: RoomAddon[];
}

export interface Movie {
  id: string;
  tmdb_id: number | null;
  imdb_id: string | null;
  title: string;
  synopsis: string | null;
  poster_url: string | null;
  runtime_minutes: number | null;
  rating: string | null;
  release_year: number | null;
  local_notes: string | null;
}

export interface Screening {
  id: string;
  movie_id: string;
  room_id: string;
  starts_at: string;
  ticket_price: number;
  capacity: number;
  attendance_reported: boolean;
  attendance_count: number | null;
  box_office_revenue: number | null;
  movie: Movie;
  room: Room;
}

export type MemberPriceTier = "adult" | "senior" | "student";

export interface CommunityProgram {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface Member {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tier: MemberTier;
  points: number;
  monthly_member: boolean;
  price_tier: MemberPriceTier | null;
  billing_interval?: "month" | "year" | null; // Insiders+ paid monthly or yearly (15% off)
  price_tier_set_by: string | null;
  price_tier_set_at: string | null;
  email_opt_in?: boolean;
  // Set when staff removed this member's personal info on request.
  erased_at?: string | null;
  erased_by_staff?: { name: string } | null;
  // Joined by the admin member queries (who set a senior/student rate).
  rate_set_by?: { name: string } | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  comped: boolean;
  // When a gifted year of Insiders+ runs out (lib/gift-membership.ts).
  // Optional: not every members query selects it.
  plus_gift_until?: string | null;
  // Their own short line (profile), shown to staff at check-in. Optional:
  // not every members query selects it.
  tagline?: string | null;
  // "2000-MM-DD": only the month and day mean anything (lib/visits.ts), for
  // the Birthday Visit badge. Optional: not every members query selects it.
  birthday?: string | null;
  community_program_id: string | null;
  comp_notes: string | null;
  comped_by: string | null;
  comped_at: string | null;
  avatar_url: string | null;
  // Set once the member has a website login. Staff logins share it (an
  // employee's auth user doubles as their member account).
  auth_user_id: string | null;
  // Only present when the query joins community_programs (see
  // getMembersPage/getMemberById) -- not selected by every members query.
  community_program?: { name: string } | null;
  created_at: string;
}

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  active: boolean;
}

export interface CalendarNote {
  id: string;
  note_date: string;
  start_time: string | null;
  end_time: string | null;
  label: string;
  created_at: string;
}

export interface Booth {
  id: string;
  label: string;
  capacity: number;
  reservation_fee: number;
  active: boolean;
  sort_order: number;
  photo_url: string | null;
}

export type BoothReservationStatus = "pending" | "confirmed" | "cancelled";

export interface BoothReservation {
  id: string;
  booth_id: string;
  member_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  party_size: number;
  reservation_date: string;
  start_time: string;
  hours: number;
  fee_amount: number;
  status: BoothReservationStatus;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  booth?: Booth;
}
