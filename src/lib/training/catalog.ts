import "server-only";

// Every training, in one list. The pictures and steps live in
// src/training/<slug>.tsx; this is what the rest of the app needs to know
// about each one. Quiz answers are here, server side only: the quiz the
// browser gets has no answers in it (publicQuiz), and sign-offs are graded
// on the server.
//
// Changing what a training says? Bump its `version`. Everyone who signed an
// older version is asked to review it and sign again.

export type TrainingCategory = "Box office" | "Register" | "House rules";

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
        prompt: "We're showing a 1986 classic on Friday. Can you post about it on the Royale's Instagram?",
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
