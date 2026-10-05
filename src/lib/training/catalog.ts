import "server-only";

// Every training, in one list. The pictures and steps live in
// src/training/<slug>.tsx; this is what the rest of the app needs to know
// about each one. Quiz answers are here, server side only: the quiz the
// browser gets has no answers in it (publicQuiz), and sign-offs are graded
// on the server.
//
// Changing what a training says? Bump its `version`. Everyone who signed an
// older version is asked to review it and sign again.

export type TrainingCategory = "Box office" | "Register" | "Back office" | "House rules";

export interface QuizQuestion {
  id: string;
  prompt: string;
  choices: string[];
  answer: number; // index into choices
  why: string; // shown once they've got it right
}

export interface TrainingModule {
  slug: string;
  title: string;
  summary: string;
  category: TrainingCategory;
  minutes: number;
  version: number;
  // Key trainings end with a quiz they have to get fully right before
  // signing off.
  quiz?: QuizQuestion[];
}

export const TRAININGS: TrainingModule[] = [
  {
    slug: "what-we-can-post",
    title: "What we can and can't post about our movies",
    summary: "Our movie license only lets us advertise this year's releases. Here's what that means for social media, signs, flyers and the schedule graphic.",
    category: "House rules",
    minutes: 4,
    version: 1,
    quiz: [
      {
        id: "classic-post",
        prompt: "We're showing a 1986 classic on Friday. Can you post about it on Royale Cinema's Instagram?",
        choices: ["Yes, if it's a story instead of a post", "No. Older titles only go to the members' email list", "Yes, as long as you don't say the time"],
        answer: 1,
        why: "Our license lets us show older movies, but only advertise this year's releases. Classics are only announced privately, by the members' email.",
      },
      {
        id: "new-release",
        prompt: "Which of these can go on a public post or a sign in the window?",
        choices: ["A movie released this year", "Any movie on the schedule", "A classic, if it's sold out"],
        answer: 0,
        why: "Only the current year's releases can be advertised publicly.",
      },
      {
        id: "flyer",
        prompt: "You're making the weekly schedule graphic to post publicly. Which edition do you pick?",
        choices: ["Members", "Public", "Either one"],
        answer: 1,
        why: "The Public edition leaves the classics off. The Members edition is only for the email list.",
      },
      {
        id: "private-event",
        prompt: "A company rented the theater Saturday night. Can the company's name go on a public post?",
        choices: ["Yes, it's good promotion", "Only if they ask us to", "No. Private-event clients' names never go on public posts or pages"],
        answer: 2,
        why: "Private events stay private. Talk to Andrew if a client wants a shout-out.",
      },
      {
        id: "unsure",
        prompt: "You're not sure whether a movie counts as a new release. What do you do?",
        choices: ["Post it and fix it later if needed", "Leave it off and ask Andrew or a manager", "Check IMDb and decide yourself"],
        answer: 1,
        why: "Getting it wrong breaks the license, so when in doubt, leave it off and ask.",
      },
    ],
  },
  {
    slug: "membership-for-a-friend",
    title: "Selling a yearly membership for a friend",
    summary: "Someone pays for a year of Insiders+ for somebody else, in the back office, in about three minutes.",
    category: "Box office",
    minutes: 5,
    version: 1,
  },
  {
    slug: "receipt-printer-setup",
    title: "Setting up a receipt printer",
    summary: "How our printers fetch their own jobs from the website, and how to add a new one: the back office, the printer's settings page, and each register's Devices.",
    category: "Back office",
    minutes: 12,
    version: 1,
    quiz: [
      {
        id: "how-it-travels",
        prompt: "How does a receipt get from the register to the printer?",
        choices: [
          "The iPad sends it straight to the printer's IP address",
          "The register puts it on the website, and the printer collects it a few seconds later",
          "The card reader passes it to the printer",
        ],
        answer: 1,
        why: "The printer asks the website for its jobs every few seconds. The iPad never talks to the printer, so there's no certificate to accept.",
      },
      {
        id: "password-once",
        prompt: "You just added a printer. When can you see its password?",
        choices: ["Any time, on the Printers page", "Only right after saving it. If it's lost, you make a new one", "It's printed on the label under the printer"],
        answer: 1,
        why: "It's shown once. Keep the Set up panel open until it's typed into the printer, or press New password to make another.",
      },
      {
        id: "last-seen",
        prompt: "The Printers page says the kitchen printer was \"Last seen 25 min ago\". What does that mean?",
        choices: [
          "It printed something 25 minutes ago",
          "It stopped asking the website for jobs 25 minutes ago: check its power, paper and network cable",
          "Nothing, that's normal between orders",
        ],
        answer: 1,
        why: "A working printer asks every few seconds and shows Online. \"Last seen\" means it has stopped asking.",
      },
      {
        id: "station",
        prompt: "Where do you choose whether a register is the Bar or the Outdoor stand?",
        choices: ["Back office → Printers", "On that register: Devices → Which register is this?", "On the printer's own settings page"],
        answer: 1,
        why: "It's saved on each iPad, and decides which printer its receipts go to. It's also printed on the kitchen's tickets.",
      },
      {
        id: "cert-error",
        prompt: "Access Test on the printer fails with a certificate error. What do you try first?",
        choices: [
          "Update the printer's root certificates, and check its date and time",
          "Turn Server Authentication off",
          "Switch the registers back to printing straight to the printer's IP",
        ],
        answer: 0,
        why: "The printer needs current certificates and the right date to trust the website. Network Security → Root Certificate Update → Update.",
      },
    ],
  },
  {
    slug: "par-count-and-shopping-list",
    title: "Par count and the shopping list",
    summary: "Counting the par sheet in the unit shown (bottles to the quarter), saving a section at a time, the shopping list, and Ran out.",
    category: "Register",
    minutes: 5,
    version: 1,
    quiz: [
      {
        id: "unit",
        prompt: "The nacho cheese line says \"Par 4 cans\". What do you count?",
        choices: ["How many servings of cheese are left", "How many cans are on the shelf", "How many cans were opened today"],
        answer: 1,
        why: "Always count in the unit shown on the line, not in servings.",
      },
      {
        id: "quarters",
        prompt: "There are 2 full bottles of well vodka and one about three-quarters full. What's the count?",
        choices: ["3", "2", "2¾"],
        answer: 2,
        why: "Bottles count to the quarter: tap + twice, then ¾ for the open one.",
      },
      {
        id: "sections",
        prompt: "You counted the candy and saved. Can you count the bar later and save that too?",
        choices: ["No, the second save replaces the first", "Yes, saves from the same day are merged", "Only if a manager says so"],
        answer: 1,
        why: "Everything saved on the same business day is merged; the shopping list uses each item's latest count from today.",
      },
      {
        id: "ran-out",
        prompt: "The hot dog buns run out at 8 PM. What do you do?",
        choices: ["Tell the next shift", "Tap Ran out, pick the buns and tick the hot dog so the register stops selling it", "Change the par count"],
        answer: 1,
        why: "Ran out puts OUT on the menu buttons that need it and puts the buns at the top of the shopping list.",
      },
    ],
  },
];

export function getTraining(slug: string): TrainingModule | null {
  return TRAININGS.find((t) => t.slug === slug) ?? null;
}

// What the browser gets: the questions without the answers.
export type PublicQuestion = Pick<QuizQuestion, "id" | "prompt" | "choices">;
export function publicQuiz(t: TrainingModule): PublicQuestion[] | null {
  return t.quiz ? t.quiz.map(({ id, prompt, choices }) => ({ id, prompt, choices })) : null;
}

// Grades a quiz: which questions they got wrong (none = passed), plus the
// "why" for every question, to show once they've passed.
export function gradeQuiz(t: TrainingModule, answers: Record<string, number>): { wrong: string[]; correct: number; total: number; why: Record<string, string> } {
  const quiz = t.quiz ?? [];
  const wrong = quiz.filter((q) => answers[q.id] !== q.answer).map((q) => q.id);
  return { wrong, correct: quiz.length - wrong.length, total: quiz.length, why: Object.fromEntries(quiz.map((q) => [q.id, q.why])) };
}
