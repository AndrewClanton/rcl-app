import { BackOfficeNav, DoDont, Hit, Need, Screen, Step, Tip, TrainingPage, s } from "@/components/training/kit";
import { centralYear } from "@/lib/mplc";

// The MPLC advertising rule (src/lib/mplc.ts) for staff: what they post,
// print and send themselves. The website, lobby TV and schedule graphic's
// Public edition already filter it automatically.
export default function WhatWeCanPost() {
  // The same "this year" the filter uses: Joplin's, not the server's UTC.
  const YEAR = centralYear();
  return (
    <TrainingPage>
      <Need title="The short version">
        We can <b>show</b> any movie, but we can only <b>advertise</b> movies released this year ({YEAR}). Older movies, the classics, are only announced
        privately: the members&apos; email list and direct messages.
      </Need>

      <Step n={1} title="Why: it's our movie license">
        <p>
          Royale Cinema plays movies under an umbrella license from MPLC. It lets us play almost anything, but it only lets us advertise the current year&apos;s
          releases. Posting a classic publicly breaks the license, even if the showing sells out.
        </p>
        <Tip>
          The website, the lobby TV and the Public schedule graphic already leave classics off automatically. This training is about what <b>you</b> post, print
          or send.
        </Tip>
      </Step>

      <Step n={2} title="What's OK and what's never OK">
        <DoDont
          okTitle="OK"
          noTitle="Never"
          ok={[
            <>Posting about a movie released in {YEAR} anywhere: Instagram, Facebook, stories, window signs</>,
            <>Telling members about classics through the members&apos; email list</>,
            <>Sending the Members schedule graphic in a direct message to one person</>,
            <>Classics on the screens inside the building that need a staff login, like the ramp TV</>,
          ]}
          no={[
            <>Posting a classic on social media, in a story, or in a comment</>,
            <>A classic on a window sign, sidewalk board or a printed flyer out in public</>,
            <>Posting the Members edition of the schedule graphic anywhere public</>,
            <>Naming a private-event client in a public post or sign</>,
          ]}
        />
      </Step>

      <Step n={3} title="Spot the difference">
        <p>Both of these are playing this Friday. Only one can be posted.</p>
        <div className={s.two}>
          <div className={s.phone} role="img" aria-label={`A post about a ${YEAR} release, marked OK`}>
            <b>royalecinemajoplin</b>
            <div className={`${s.poster} ${s.posterOk}`}>
              A new {YEAR} release
              <br />
              Friday 7:00 PM
            </div>
            <span className={`${s.stamp} ${s.stampOk}`} style={{ position: "static", justifySelf: "start", transform: "rotate(-3deg)" }}>
              ✓ OK to post
            </span>
          </div>
          <div className={s.phone} role="img" aria-label="A post about a 1986 classic, marked Never">
            <b>royalecinemajoplin</b>
            <div className={`${s.poster} ${s.posterNo}`}>
              Labyrinth (1986)
              <br />
              Friday 9:00 PM
              <span className={`${s.stamp} ${s.stampNo}`}>Never</span>
            </div>
            <span className={s.small}>Members&apos; email only</span>
          </div>
        </div>
      </Step>

      <Step n={4} title="Making the schedule graphic? Pick Public">
        <p>
          In the back office, <b>Schedule graphic</b> has an Audience switch. <b>Public</b> leaves the classics off and is safe to post anywhere. <b>Members (email
          list)</b> includes them, and is only for the email list and direct messages.
        </p>
        <Screen url="www.royalecinemajoplin.com/admin/schedule-graphic" caption="Back office → Schedule graphic" label="Schedule graphic page with the Public audience button highlighted">
          <BackOfficeNav ring="Schedule graphic" n="a" />
          <div className={s.card}>
            <div className={s.small}>Audience</div>
            <div className={s.row} style={{ marginTop: 4 }}>
              <Hit n="b" className={s.btnRed} >
                Public
              </Hit>
              <span className={s.btnLine}>Members (email list)</span>
            </div>
            <div className={s.small} style={{ marginTop: 6 }}>
              Safe to post anywhere. 2 older titles in this range are left off.
            </div>
          </div>
        </Screen>
      </Step>

      <Step n={5} title="Not sure? Leave it off and ask">
        <p>
          If you can&apos;t tell whether a movie counts as a {YEAR} release, don&apos;t post it. Ask Andrew or a manager first. A late post is fine; a license
          problem isn&apos;t.
        </p>
      </Step>
    </TrainingPage>
  );
}
