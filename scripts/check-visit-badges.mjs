// Checks the check-in rules in src/lib/visits.ts without a database:
//  1. Business days and times of day in Central time: the 8:29/8:30 AM
//     Early Riser edge, the 10:59/11:00 PM Night Owl edge, 3:59 AM belonging
//     to the day before, and both nights the clocks change.
//  2. Weeks: Mondays, and the week streak (a closed week in the middle
//     doesn't break it, a missed open week does, this week isn't over yet).
//  3. Birthday weeks, across a year boundary (Dec 30, Jan 1) and Feb 29.
//  4. Which badges a visit earns: milestones by number, the week badges and
//     their rewards, and the tablet/register wording.
//
// Usage: node scripts/check-visit-badges.mjs   (Node 23.6+ runs the .ts directly)

const v = await import("../src/lib/visits.ts");
const { badgesFor, badgeFor, badgeCheer, badgeList, birthdayLabel, birthdayMonthDay, birthdayValue, birthdayWeekYear } = v;
const { centralClock, isEarlyRiser, isNightOwl, nextWeekBadge, recentWeeks, shiftDay, visitBusinessDate, weekStart, weekStreak, BADGES, VISIT_POINTS } = v;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---------- 1. times of day ----------
// Central is UTC-5 in daylight time (CDT), UTC-6 in standard time (CST).
const cdt = (date, time) => new Date(`${date}T${time}:00-05:00`);
const cst = (date, time) => new Date(`${date}T${time}:00-06:00`);

eq("VISIT_POINTS is 5", VISIT_POINTS, 5);
check("8:29 AM is an Early Riser", isEarlyRiser(cdt("2026-10-02", "08:29")));
check("8:29:59 AM still is", isEarlyRiser(new Date("2026-10-02T08:29:59-05:00")));
check("8:30 AM isn't", !isEarlyRiser(cdt("2026-10-02", "08:30")));
check("4:00 AM is (the business day's first minute)", isEarlyRiser(cdt("2026-10-02", "04:00")));
check("3:59 AM isn't (that's the night before)", !isEarlyRiser(cdt("2026-10-02", "03:59")));
check("10:59 PM isn't a Night Owl", !isNightOwl(cdt("2026-10-02", "22:59")));
check("11:00 PM is", isNightOwl(cdt("2026-10-02", "23:00")));
check("12:30 AM is", isNightOwl(cdt("2026-10-03", "00:30")));
check("3:59 AM is", isNightOwl(cdt("2026-10-03", "03:59")));
check("4:00 AM isn't", !isNightOwl(cdt("2026-10-03", "04:00")));
eq("3:59 AM Saturday counts for Friday", visitBusinessDate(cdt("2026-10-03", "03:59")), "2026-10-02");
eq("4:00 AM Saturday is Saturday", visitBusinessDate(cdt("2026-10-03", "04:00")), "2026-10-03");
eq("11:30 PM Friday is Friday", visitBusinessDate(cdt("2026-10-02", "23:30")), "2026-10-02");
{
  // Night Owl at 3:59 AM belongs to the day before, and says so.
  const at = cdt("2026-10-03", "03:59");
  const claims = badgesFor({ at, visitNumber: 2, weekStreak: 1, birthday: null });
  check("a 3:59 AM check-in earns Night Owl for the day before", claims.some((c) => c.key === "night_owl") && visitBusinessDate(at) === "2026-10-02");
  check("  and not Early Riser", !claims.some((c) => c.key === "early_riser"));
}

// Clocks go back: Sunday Nov 1, 2026, 2:00 AM CDT becomes 1:00 AM CST.
eq("DST ends: 1:30 AM CDT (the first one) counts for Saturday", visitBusinessDate(cdt("2026-11-01", "01:30")), "2026-10-31");
eq("DST ends: 1:30 AM CST (the second one) too", visitBusinessDate(cst("2026-11-01", "01:30")), "2026-10-31");
eq("DST ends: 3:59 AM CST is still Saturday's", visitBusinessDate(cst("2026-11-01", "03:59")), "2026-10-31");
check("  and a Night Owl", isNightOwl(cst("2026-11-01", "03:59")));
eq("DST ends: 4:00 AM CST starts Sunday", visitBusinessDate(cst("2026-11-01", "04:00")), "2026-11-01");
check("  as an Early Riser", isEarlyRiser(cst("2026-11-01", "04:00")));
check("DST ends: 8:29 AM CST is an Early Riser, 8:30 isn't", isEarlyRiser(cst("2026-11-01", "08:29")) && !isEarlyRiser(cst("2026-11-01", "08:30")));
check("DST ends: 10:59 PM CST isn't a Night Owl, 11:00 is", !isNightOwl(cst("2026-11-01", "22:59")) && isNightOwl(cst("2026-11-01", "23:00")));
eq("centralClock reads CST after the change", centralClock(new Date("2026-11-01T10:00:00Z")), { date: "2026-11-01", minutes: 4 * 60 });
// Clocks go forward: Sunday Mar 8, 2026, 2:00 AM CST becomes 3:00 AM CDT.
eq("DST starts: 1:59 AM CST counts for Saturday", visitBusinessDate(cst("2026-03-08", "01:59")), "2026-03-07");
eq("DST starts: 3:59 AM CDT is still Saturday's", visitBusinessDate(cdt("2026-03-08", "03:59")), "2026-03-07");
eq("DST starts: 4:00 AM CDT starts Sunday", visitBusinessDate(cdt("2026-03-08", "04:00")), "2026-03-08");
check("  as an Early Riser", isEarlyRiser(cdt("2026-03-08", "04:00")) && !isNightOwl(cdt("2026-03-08", "04:00")));
check("DST starts: 8:29 AM CDT is an Early Riser, 8:30 isn't", isEarlyRiser(cdt("2026-03-08", "08:29")) && !isEarlyRiser(cdt("2026-03-08", "08:30")));
eq("a winter evening: 11:00 PM CST Jan 15 is a Night Owl on Jan 15", [isNightOwl(cst("2026-01-15", "23:00")), visitBusinessDate(cst("2026-01-15", "23:00"))], [true, "2026-01-15"]);

// ---------- 2. weeks ----------
eq("Monday of a Wednesday", weekStart("2026-09-30"), "2026-09-28");
eq("a Monday is its own week", weekStart("2026-09-28"), "2026-09-28");
eq("a Sunday belongs to the Monday before", weekStart("2026-10-04"), "2026-09-28");
eq("the week the clocks go back (Sun Nov 1) starts Mon Oct 26", weekStart("2026-11-01"), "2026-10-26");
eq("  and the next starts Mon Nov 2", weekStart("2026-11-02"), "2026-11-02");
eq("the week the clocks go forward (Sun Mar 8) starts Mon Mar 2", weekStart("2026-03-08"), "2026-03-02");
eq("across a year: Thu Jan 1 2026 is in the week of Mon Dec 29 2025", weekStart("2026-01-01"), "2025-12-29");
eq("shiftDay across a month", shiftDay("2026-09-30", 2), "2026-10-02");
eq("the last 13 weeks end with this one", [recentWeeks("2026-09-30", 13).length, recentWeeks("2026-09-30", 13)[0], recentWeeks("2026-09-30", 13)[12]], [13, "2026-07-06", "2026-09-28"]);

{
  const open = () => true;
  // Weekly visits on Fridays, Sep 4 .. Sep 25, then today (Wed Sep 30).
  const fridays = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"];
  eq("4 weeks in a row, then checking in this week: 5", weekStreak("2026-09-30", [...fridays, "2026-09-30"], open), 5);
  eq("not in yet this week: the streak so far still stands (4)", weekStreak("2026-09-30", fridays, open), 4);
  eq("two visits in one week count once", weekStreak("2026-09-25", ["2026-09-21", "2026-09-25"], open), 1);
  eq("never checked in: 0", weekStreak("2026-09-30", [], open), 0);
  eq("visits after the date don't count", weekStreak("2026-09-18", [...fridays, "2026-09-30"], open), 3);
  // Missed the week of Sep 14, and the Royale was open that week.
  const missed = ["2026-09-04", "2026-09-11", "2026-09-25", "2026-09-30"];
  eq("a missed open week breaks it", weekStreak("2026-09-30", missed, open), 2);
  // Same, but the Royale was closed the week of Sep 14.
  const closedWeek = (monday) => monday !== "2026-09-14";
  eq("a closed week in the middle doesn't", weekStreak("2026-09-30", missed, closedWeek), 4);
  eq("  (nor two closed weeks)", weekStreak("2026-09-30", ["2026-08-28", "2026-09-25", "2026-09-30"], (m) => m !== "2026-09-07" && m !== "2026-09-14" && m !== "2026-08-31"), 3);
  eq("missed last week (open): only this week counts", weekStreak("2026-09-30", ["2026-09-18", "2026-09-30"], open), 1);
  eq("missed last week and not in yet this week: 0", weekStreak("2026-09-30", ["2026-09-18"], open), 0);
  // Every week through both DST changes: Oct 19 .. Nov 9 and Mar 2 .. Mar 16.
  eq("weeks through the fall DST change", weekStreak("2026-11-09", ["2026-10-19", "2026-10-26", "2026-11-01", "2026-11-02", "2026-11-09"], open), 4);
  eq("weeks through the spring DST change", weekStreak("2026-03-16", ["2026-03-02", "2026-03-08", "2026-03-09", "2026-03-16"], open), 3);
  eq("Sunday Nov 1 and Monday Nov 2 are different weeks", weekStreak("2026-11-02", ["2026-11-01", "2026-11-02"], open), 2);
  eq("a streak across New Year", weekStreak("2026-01-05", ["2025-12-22", "2025-12-29", "2026-01-01", "2026-01-05"], open), 3);
  eq("52 Mondays in a row: 52", weekStreak("2027-09-27", Array.from({ length: 52 }, (_, i) => shiftDay("2026-10-05", 7 * i)), open), 52);
}
eq("next week badge from 0", [nextWeekBadge(0)?.badge.key, nextWeekBadge(0)?.weeksLeft], ["weeks_4", 4]);
eq("next week badge from 5", [nextWeekBadge(5)?.badge.key, nextWeekBadge(5)?.weeksLeft], ["weeks_13", 8]);
eq("none past 52", nextWeekBadge(52), null);

// ---------- 3. birthdays ----------
eq("month and day stored in 2000", birthdayValue(12, 30), "2000-12-30");
eq("Feb 29 is a birthday", birthdayValue(2, 29), "2000-02-29");
eq("Feb 30 isn't", birthdayValue(2, 30), null);
eq("month 13 isn't", birthdayValue(13, 1), null);
eq("reads back any year", birthdayMonthDay("1987-12-30"), { month: 12, day: 30 });
eq("label", birthdayLabel("2000-12-30"), "December 30");
eq("no birthday: never a birthday week", birthdayWeekYear(null, "2026-12-30"), null);
// Dec 30, 2026 is a Wednesday: its week is Mon Dec 28, 2026 to Sun Jan 3, 2027.
eq("Dec 30 birthday, visit on the day", birthdayWeekYear("2000-12-30", "2026-12-30"), 2026);
eq("Dec 30 birthday, visit Mon Dec 28", birthdayWeekYear("2000-12-30", "2026-12-28"), 2026);
eq("Dec 30 birthday, visit Sat Jan 2 2027: still the 2026 birthday", birthdayWeekYear("2000-12-30", "2027-01-02"), 2026);
eq("Dec 30 birthday, visit Sun Jan 3 2027: last day of it", birthdayWeekYear("2000-12-30", "2027-01-03"), 2026);
eq("Dec 30 birthday, visit Mon Jan 4 2027: over", birthdayWeekYear("2000-12-30", "2027-01-04"), null);
eq("Dec 30 birthday, visit Sun Dec 27 2026: not yet", birthdayWeekYear("2000-12-30", "2026-12-27"), null);
// Jan 1, 2027 is a Friday: its week starts Mon Dec 28, 2026.
eq("Jan 1 birthday, visit Tue Dec 29 2026: the 2027 birthday", birthdayWeekYear("2000-01-01", "2026-12-29"), 2027);
eq("Jan 1 birthday, visit Jan 1 2027", birthdayWeekYear("2000-01-01", "2027-01-01"), 2027);
eq("Feb 29 birthday in 2027 (no Feb 29): the week of Feb 28", birthdayWeekYear("2000-02-29", "2027-02-26"), 2027);
eq("Feb 29 birthday in 2028: the week of Feb 29", birthdayWeekYear("2000-02-29", "2028-03-01"), 2028);
{
  const at = new Date("2027-01-02T20:00:00-06:00");
  const c = badgesFor({ at, visitNumber: 5, weekStreak: 1, birthday: "2000-12-30" }).find((x) => x.key === "birthday");
  eq("the badge's period is the birthday's year (2026), not the visit's", c?.period, "2026");
  const later = badgesFor({ at: new Date("2027-12-30T20:00:00-06:00"), visitNumber: 9, weekStreak: 1, birthday: "2000-12-30" }).find((x) => x.key === "birthday");
  eq("  so the next birthday (Dec 2027) can still earn its own", later?.period, "2027");
}

// ---------- 4. which badges ----------
const keys = (facts) => badgesFor({ at: cdt("2026-10-02", "19:00"), visitNumber: 1, weekStreak: 1, birthday: null, ...facts }).map((c) => c.key).sort();
eq("first visit, 7 PM: Welcome", keys({}), ["welcome"]);
eq("9th visit: nothing new past Welcome", keys({ visitNumber: 9 }), ["welcome"]);
eq("10th visit: Regular", keys({ visitNumber: 10 }), ["visits_10", "welcome"]);
eq("49th: no Fixture yet", keys({ visitNumber: 49 }).includes("visits_50"), false);
eq("50th: Fixture", keys({ visitNumber: 50 }), ["visits_10", "visits_50", "welcome"]);
eq("100th: Legend", keys({ visitNumber: 100 }), ["visits_10", "visits_100", "visits_50", "welcome"]);
eq("3 weeks: no 4 Weeks yet", keys({ weekStreak: 3 }).includes("weeks_4"), false);
eq("4 weeks: 4 Weeks", keys({ weekStreak: 4 }), ["weeks_4", "welcome"]);
eq("13 weeks: A Season", keys({ weekStreak: 13 }), ["weeks_13", "weeks_4", "welcome"]);
eq("26 weeks: Half a Year", keys({ weekStreak: 26 }), ["weeks_13", "weeks_26", "weeks_4", "welcome"]);
eq("52 weeks: Week for a Year", keys({ weekStreak: 52 }).includes("weeks_52"), true);
eq("51 weeks: not yet", keys({ weekStreak: 51 }).includes("weeks_52"), false);
eq("early and first: Welcome and Early Riser", keys({ at: cdt("2026-10-03", "07:45") }), ["early_riser", "welcome"]);
eq("late: Night Owl", keys({ at: cdt("2026-10-02", "23:15") }), ["night_owl", "welcome"]);
eq("birthday week", keys({ at: cdt("2026-12-29", "19:00"), birthday: "2000-12-30" }), ["birthday", "welcome"]);
check("once-ever badges have an empty period", badgesFor({ at: cdt("2026-10-02", "23:15"), visitNumber: 10, weekStreak: 4, birthday: null }).every((c) => c.period === ""));

eq("A Season gives a popcorn", badgeFor("weeks_13")?.reward, "popcorn");
eq("Half a Year gives a pizza", badgeFor("weeks_26")?.reward, "pizza");
check("no other badge gives a reward", BADGES.filter((b) => b.reward).map((b) => b.key).join() === "weeks_13,weeks_26");
eq("points", Object.fromEntries(BADGES.map((b) => [b.key, b.points])), {
  welcome: 50,
  early_riser: 25,
  night_owl: 25,
  birthday: 50,
  weeks_4: 25,
  weeks_13: 75,
  weeks_26: 150,
  weeks_52: 500,
  visits_10: 25,
  visits_50: 100,
  visits_100: 250,
});
check("every badge has an emoji, a label and how to earn it", BADGES.every((b) => b.emoji && b.label && b.how && b.cheer.includes("{name}")));
check("keys are unique", new Set(BADGES.map((b) => b.key)).size === BADGES.length);
eq("an unknown key isn't a badge", [badgeFor("free_car"), badgeFor(undefined)], [null, null]);
eq("the Night Owl banner", badgeCheer(badgeFor("night_owl"), "Maya"), { emoji: "🦉", title: "Maya, you're a Night Owl!", detail: "+25 points" });
eq("the Season banner mentions the popcorn", badgeCheer(badgeFor("weeks_13"), "Maya").detail, "+75 points and a free popcorn! Just ask your bartender.");
eq("the register's list", badgeList([badgeFor("night_owl"), badgeFor("welcome")]), "🦉 Night Owl (+25), 🎟️ Welcome (+50)");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll visit-badge checks passed.");
process.exit(failures ? 1 : 0);
