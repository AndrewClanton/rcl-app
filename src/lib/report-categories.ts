// What Reports call each kind of sale ("What sold"), shared by the server
// (src/lib/data/reports.ts adds them up) and the Day report's drill-downs
// in the browser (which filter orders by them).

export const CATEGORY_LABEL = { food: "Food", other: "Candy & other", soda: "Drinks", coffee: "Coffee", liquor: "Alcohol" } as const;
export const TICKETS_LABEL = "Movie tickets";
export const BOOTHS_LABEL = "Booths";
// Insiders+ charges and gift memberships (Stripe billing, not the register).
export const MEMBERSHIPS_LABEL = "Insiders+ memberships";

// What Nathan's inventory and expense rules count ("Where the money goes").
export const FOOD_AND_DRINK = "Food & drink";
export const FOOD_AND_DRINK_CATEGORIES: string[] = [CATEGORY_LABEL.food, CATEGORY_LABEL.soda, CATEGORY_LABEL.coffee, CATEGORY_LABEL.liquor];
