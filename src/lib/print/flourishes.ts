// Easter eggs for the bottom of a receipt: little pictures and one-liners
// staff can add for fun (Register → ✨), printed with no explanation. Plain
// ASCII only: the receipt printer can't print anything fancier as text, and
// the receipt builder folds everything else to ASCII anyway. Keep each line
// under 40 characters so it centers on the 48-column paper.

export type FlourishKey = "stars" | "popcorn" | "reel" | "cat" | "ghost" | "meme";

export const FLOURISHES: { key: FlourishKey; label: string; icon: string }[] = [
  { key: "stars", label: "Stars", icon: "✨" },
  { key: "popcorn", label: "Popcorn", icon: "🍿" },
  { key: "reel", label: "Film reel", icon: "🎞️" },
  { key: "cat", label: "Cat", icon: "🐱" },
  { key: "ghost", label: "Ghost", icon: "👻" },
  { key: "meme", label: "Random joke line", icon: "😂" },
];

const ART: Record<Exclude<FlourishKey, "meme">, string[]> = {
  stars: [
    "*     .      *    .       *",
    "   .     *       .    *     .",
    "*     .     *  .     *     .",
    "   *     .      *      .   *",
  ],
  popcorn: [
    "  o  O  o  O  o  ",
    " O  o  O  o  O  o",
    "|~~~~~~~~~~~~~~~~|",
    " \\ ||  ||  ||  / ",
    "  \\||  ||  || /  ",
    "   \\__________/   ",
  ],
  reel: [
    "    .-------.    ",
    "  .'  O   O  '.  ",
    " /      _      \\ ",
    "|  O   (_)   O  |",
    " \\             / ",
    "  '.  O   O  .'  ",
    "    '-------'    ",
  ],
  cat: ["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " meow. "],
  ghost: ["   .-.      ", "  (o o) boo!", "  | O \\     ", "   \\   \\    ", "    `~~~'   "],
};

const MEMES: string[][] = [
  ["such movie. very popcorn.", "wow."],
  ["\\_('_')_/", "it's movie time"],
  ["You are the main character", "today. Act accordingly."],
  ["Achievement unlocked:", "REGULAR"],
  ["10/10", "would watch again"],
  ["(o_o)", "...more popcorn?"],
  ["Plot twist:", "you were the popcorn all along."],
  ["Certified cool person.", "We checked."],
  ["Roses are red, screens are big,", "thanks for coming, you're a delight."],
];

// The lines to print for a flourish (a random joke line for "meme").
export function flourishLines(key: FlourishKey | null): string[] | null {
  if (!key) return null;
  if (key === "meme") return MEMES[Math.floor(Math.random() * MEMES.length)];
  return ART[key];
}
