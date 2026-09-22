export type ModifierType = "single" | "multi";
export type EventPriceMode = "deposit" | "full";
export type OrderSource = "pos" | "web";
export type OrderStatus = "draft" | "held" | "tab" | "completed" | "refunded" | "voided";
export type PaymentMethod = "cash" | "card" | "split";
export type EmployeeRole = "cashier" | "manager" | "admin" | "owner";
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
  modifier_groups: ModifierGroup[];
}

export interface MenuCategory {
  id: string;
  key: string;
  label: string;
  parent_id: string | null;
  sort_order: number;
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
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  comped: boolean;
  community_program_id: string | null;
  comp_notes: string | null;
  comped_by: string | null;
  comped_at: string | null;
  avatar_url: string | null;
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
