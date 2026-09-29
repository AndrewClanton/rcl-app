import { requireMember } from "@/lib/member-auth";
import { getMemberScreenings } from "@/lib/data/member-account";
import MoviesView from "./MoviesView";

export const metadata = { title: "Movies" };

export default async function MoviesPage() {
  const member = await requireMember();
  const { upcoming, past, tonight } = await getMemberScreenings(member.id);
  return <MoviesView upcoming={upcoming} past={past} tonight={tonight} />;
}
