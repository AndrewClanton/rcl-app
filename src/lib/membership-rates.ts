import type { MemberPriceTier } from "@/lib/types";

// Insiders+ monthly price by rate. Senior and student are set in person by
// staff after checking an ID, never chosen online.
export const RATE_PRICE: Record<MemberPriceTier, number> = { adult: 15, senior: 12, student: 10 };
export const RATE_LABEL: Record<MemberPriceTier, string> = { adult: "Adult", senior: "Senior", student: "Student" };
export const RATE_ORDER: MemberPriceTier[] = ["adult", "senior", "student"];
