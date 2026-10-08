import type { Member } from "@/lib/types";
import { firstNameOf } from "@/lib/checkin";
import { parseFlair, flairKeys } from "@/lib/flair";
import { visibleLine } from "@/lib/member-profile";
import { Panel } from "../ui";
import SharingPanel from "./SharingPanel";
import CheckinFlairPanel from "./CheckinFlairPanel";
import PerksPanel, { type OwnedPerkKey } from "./PerksPanel";
import { parseLook } from "@/lib/rewards";

// The Profile tab's fun half: their shared profile page, and their
// entrance on the check-in screen. Only the fields each form needs go to
// the browser. Before the member_profiles migration the columns aren't on
// the row yet: the forms say so, and the previews still play.
export default function ProfilePanels({ member, owned = [] }: { member: Member; owned?: OwnedPerkKey[] }) {
  const ready = member.share_profile !== undefined;
  const sharing = ready && member.share_profile === true && !!member.profile_handle && !member.profile_hidden_at;
  return (
    <>
      <Panel title="Your profile page" aside={sharing ? "Shared" : "Off"} className="lg:col-span-2">
        <SharingPanel
          ready={ready}
          share={member.share_profile === true}
          handle={member.profile_handle ?? ""}
          displayName={member.display_name ?? ""}
          name={member.name}
          blocked={!!member.profile_hidden_at}
          lineHidden={!!member.tagline && !!member.tagline_hidden_at}
          hasPhoto={!!member.avatar_url}
        />
      </Panel>
      <Panel title="Your check-in" aside="At the door" className="lg:col-span-2">
        <CheckinFlairPanel
          ready={ready}
          flair={flairKeys(parseFlair(member))}
          birthdayParty={member.birthday_party !== false}
          hasBirthday={!!member.birthday}
          firstName={firstNameOf(member.name)}
          line={visibleLine(member)}
          ownedEntrances={owned.filter((o) => o.slot === "entrance").map((o) => o.key)}
        />
      </Panel>
      <Panel title="Unlocked with points" aside="Spend points at the bar" className="lg:col-span-2">
        <PerksPanel owned={owned} look={parseLook(member)} name={member.display_name?.trim() || firstNameOf(member.name)} color={member.flair_color ?? null} />
      </Panel>
    </>
  );
}
