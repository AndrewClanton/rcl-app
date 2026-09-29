import { BackOfficeNav, Hit, Need, Screen, Step, Tip, TrainingPage, s } from "@/components/training/kit";

// Someone buying a yearly Insiders+ for a friend, as the back office works
// today (Members → Add member → Billing → Yearly). When the one-payment
// Gift button goes live, rewrite this and bump its version in the catalog.
export default function MembershipForAFriend() {
  return (
    <TrainingPage>
      <Need title="Get these from the buyer first">
        Their friend&apos;s full name and email address. The email is required: the membership is tied to it, and Stripe sends the receipts there.
      </Need>

      <Step n={1} title="Open the back office and tap Members">
        <p>
          Go to <b>rcl-app.vercel.app/admin</b> and sign in. The menu is the row of words under the title. On a phone it wraps onto a few lines.
        </p>
        <Screen url="rcl-app.vercel.app/admin" caption="Back office · top of every page" label="Back office with the Members link highlighted in the menu">
          <BackOfficeNav ring="Members" n={1} />
        </Screen>
      </Step>

      <Step n={2} title={'Scroll all the way down to "+ Add member"'}>
        <p>
          This is the one that&apos;s easy to miss. The button sits <b>under the whole member list</b>, below the page numbers.
        </p>
        <Screen url="rcl-app.vercel.app/admin/members" caption="Members page · bottom" label="Members page: search, member list, page numbers, then the Add member button">
          <div className={s.card}>
            <div className={s.row}>
              <span className={`${s.input} ${s.grow}`}>Search members by name or email...</span>
              <span className={s.small}>☐ Community/free members only</span>
            </div>
          </div>
          <div className={`${s.card} ${s.cardFlush}`}>
            <div className={s.item}>
              <span className={s.name}>Alex Example</span>
              <span className={s.mail}>alex@example.com</span>
              <span className={`${s.pill} ${s.pillPlus}`}>Insiders+</span>
              <span className={s.pts}>212 pts</span>
            </div>
            <div className={s.item}>
              <span className={s.name}>Casey Example</span>
              <span className={s.mail}>casey@example.com</span>
              <span className={s.pill}>Insiders</span>
              <span className={s.pts}>40 pts</span>
            </div>
            <div className={`${s.item} ${s.faded}`}>
              <span className={s.name}>… lots more members …</span>
            </div>
            <div className={s.pager}>
              <span>Showing 1–25 of 1,900</span>
              <span>Prev · Page 1 of 76 · Next</span>
            </div>
          </div>
          <div className={s.arrow}>↓ Keep scrolling past the list</div>
          <Hit n={2} className={s.dashed}>
            + Add member
          </Hit>
        </Screen>
      </Step>

      <Step n={3} title="Type the friend's name and email, then Add member">
        <p>
          Leave the level on <b>Insiders</b>. It switches to Insiders+ by itself once the buyer pays.
        </p>
        <Screen url="rcl-app.vercel.app/admin/members" caption={'"Email (optional)" isn\'t optional for this one'} label="Add member form filled in, with the Add member button highlighted">
          <div className={s.card}>
            <h4 className={s.cardTitle}>Add member</h4>
            <div className={s.row}>
              <span className={`${s.input} ${s.filled} ${s.grow}`}>Jamie Friend</span>
              <span className={`${s.input} ${s.filled} ${s.grow}`}>jamie@example.com</span>
              <span className={`${s.input} ${s.filled}`}>Insiders ▾</span>
              <Hit n={3} className={s.btnRed}>
                Add member
              </Hit>
              <span className={s.small}>Cancel</span>
            </div>
          </div>
        </Screen>
      </Step>

      <Step n={4} title="Search their name and tap them">
        <p>The form closes after you add them. Scroll back up to the search box, type the friend&apos;s name, and tap their row.</p>
        <Screen url="rcl-app.vercel.app/admin/members?q=jamie" caption="Members page · top" label="Members search with the new member's row highlighted">
          <div className={s.card}>
            <div className={s.row}>
              <span className={`${s.input} ${s.filled} ${s.grow}`}>jamie</span>
            </div>
          </div>
          <div className={`${s.card} ${s.cardFlush}`}>
            <Hit n={4} className={s.item}>
              <span className={s.name}>Jamie Friend</span>
              <span className={s.mail}>jamie@example.com</span>
              <span className={s.pill}>Insiders</span>
              <span className={s.pts}>0 pts</span>
              <span className={s.dim}>→</span>
            </Hit>
          </div>
        </Screen>
      </Step>

      <Step n={5} title="Scroll to Billing, pick Yearly, tap Open card page">
        <p>
          On their page, scroll past their details and the <b>Free / community membership</b> box. The <b>Billing</b> box is next. Leave &quot;First charge&quot;
          blank so it charges today.
        </p>
        <Screen url="rcl-app.vercel.app/admin/members/…" caption="Member page · third box down" label="Billing box with Yearly selected and Open card page highlighted">
          <div className={`${s.card} ${s.faded}`}>
            <div className={s.row}>
              <b style={{ fontSize: 15 }}>Jamie Friend</b>
              <span className={s.pill}>Insiders</span>
            </div>
          </div>
          <div className={`${s.card} ${s.faded}`}>
            <h4 className={s.cardTitle} style={{ margin: 0 }}>
              Free / community membership
            </h4>
          </div>
          <div className={s.card}>
            <h4 className={s.cardTitle}>Billing</h4>
            <div style={{ display: "grid", gap: 10 }}>
              <div>No card on file. To start their Insiders+ billing:</div>
              <div className={s.row}>
                <span>Plan</span>
                <span className={s.chip}>Monthly · $15</span>
                <Hit n="5a" className={`${s.chip} ${s.chipOn}`}>
                  Yearly · $153 (15% off)
                </Hit>
              </div>
              <div className={s.row}>
                <span>First charge</span>
                <span className={s.input}>mm/dd/yyyy</span>
                <span className={s.small}>Blank = charge today</span>
              </div>
              <div className={s.row}>
                <Hit n="5b" className={s.btnRed}>
                  Open card page
                </Hit>
                <span className={s.btnLine}>Get a link to text them</span>
              </div>
            </div>
          </div>
        </Screen>
        <Tip>
          <b>Buyer not standing there?</b> Tap <b>Get a link to text them</b>, copy the link, and text it to the buyer so they can pay on their own phone. It works
          for 24 hours.
        </Tip>
      </Step>

      <Step n={6} title="Hand the device to the buyer to pay">
        <p>
          Stripe&apos;s page opens in a new tab. The buyer types their card and taps Subscribe. It&apos;s <b>$153 plus $13.35 sales tax = $166.35</b>.
        </p>
        <Screen url="checkout.stripe.com" caption="Drawn loosely · Stripe's page may look a little different" label="Stripe payment page, $166.35, with a Subscribe button" stripe>
          <div className={s.sMuted}>Royale Cinema Lounge</div>
          <div>Subscribe to Insiders+</div>
          <div className={s.sBig}>
            $153.00{" "}
            <span className={s.sMuted} style={{ fontSize: 13, fontWeight: 400 }}>
              per year
            </span>
          </div>
          <div>
            <div className={s.sLine}>
              <span>Sales tax</span>
              <span>$13.35</span>
            </div>
            <div className={`${s.sLine} ${s.sTotal}`}>
              <span>Total due today</span>
              <span>$166.35</span>
            </div>
          </div>
          <div className={s.sField}>Email · jamie@example.com</div>
          <div className={s.sField}>Card number · MM / YY · CVC</div>
          <Hit n={6} className={s.sBtn}>
            Subscribe
          </Hit>
        </Screen>
        <Tip>
          The email shown is the <b>friend&apos;s</b>, not the buyer&apos;s. That&apos;s expected: Stripe&apos;s receipts go to the friend. If it&apos;s a surprise,
          give the buyer a heads-up.
        </Tip>
      </Step>

      <Step n={7} title="Refresh the member page to check it worked">
        <p>
          Switch back to the back office tab and refresh. The badge should say <b>Insiders+</b> and Billing should say <b>Subscription: active</b>. If it
          doesn&apos;t after a minute, tell a manager.
        </p>
        <Screen url="rcl-app.vercel.app/admin/members/…" caption="Member page · done" label="Member page after paying: Insiders+ badge and Subscription active">
          <div className={s.card}>
            <div className={s.row}>
              <b style={{ fontSize: 15 }}>Jamie Friend</b>
              <Hit n={7} className={`${s.pill} ${s.pillPlus}`}>
                Insiders+
              </Hit>
            </div>
          </div>
          <div className={s.card}>
            <h4 className={s.cardTitle}>Billing</h4>
            <div className={s.row}>
              <span className={s.dim}>Subscription: active</span>
              <span className={s.btnLine}>Update payment method / card on file</span>
            </div>
          </div>
        </Screen>
      </Step>

      <Step n={8} optional title="One-year gift only: stop it renewing next year">
        <p>
          As set up above, it renews on the buyer&apos;s card every year. If they only want to pay for one year, a manager cancels it <b>at the end of the period</b>{" "}
          in Stripe. The friend keeps Insiders+ for the full year and nobody gets charged again.
        </p>
        <div className={s.two}>
          <Screen url="dashboard.stripe.com" caption="a · Search their email, open the subscription" label="Stripe customer page with Cancel subscription" stripe>
            <div className={s.sField}>🔍 jamie@example.com</div>
            <div className={s.sMuted}>Customers › Jamie Friend</div>
            <div>
              <b>Subscriptions</b>
            </div>
            <div className={s.sLine}>
              <span>Insiders+ · Active</span>
              <Hit n="8a">⋯ Cancel subscription</Hit>
            </div>
          </Screen>
          <Screen url="dashboard.stripe.com" caption={'b · Never pick "Immediately"'} label="Stripe cancel dialog with End of the current period selected" stripe>
            <div>
              <b>Cancel subscription</b>
            </div>
            <div className={s.sRadio}>
              <i />
              <span>Immediately</span>
            </div>
            <Hit n="8b" className={`${s.sRadio} ${s.sSel}`}>
              <i />
              <span>
                <b>End of the current period</b>
                <br />
                <span className={s.sMuted}>One year from today</span>
              </span>
            </Hit>
            <div className={s.sRadio}>
              <i />
              <span>On a custom date</span>
            </div>
            <div className={`${s.sBtn} ${s.sDanger}`}>Cancel subscription</div>
          </Screen>
        </div>
        <Tip>
          Stripe&apos;s wording may differ a little; pick the option that ends it <b>at the end of the current period</b>. &quot;Immediately&quot; would switch the
          friend&apos;s Insiders+ off today.
        </Tip>
      </Step>
    </TrainingPage>
  );
}
