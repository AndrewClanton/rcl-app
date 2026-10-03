import { Hit, Need, Screen, Step, Tip, TrainingPage, s } from "@/components/training/kit";
import { SITE_URL } from "@/lib/site";

// The par count, counting in quarters, the shopping list and "Ran out", on
// the register's shift bar (src/app/pos/shift/). Written for the par sheet
// that saves a section at a time and counts bottles to the quarter. Change
// the steps? Bump the version in the catalog.
const HOST = SITE_URL.replace(/^https?:\/\//, "");

// One line of the drawn par sheet.
function Line({ name, par, last, value, unit, low, quarters, ring }: { name: string; par: string; last: string; value: string; unit: string; low?: string; quarters?: string; ring?: string }) {
  return (
    <div className={s.item} style={low ? { background: "var(--warn-bg)" } : undefined}>
      <span className={s.name}>
        <b>{name}</b>
        <span className={s.small} style={{ display: "block" }}>
          Par {par} · last count {last}
        </span>
        {low && (
          <span className={s.small} style={{ display: "block", color: "var(--warn-tx)", fontWeight: 700 }}>
            {low}
          </span>
        )}
      </span>
      <span className={s.row} style={{ gap: 6 }}>
        <span className={s.chip}>= par</span>
        {quarters &&
          (ring === "quarters" ? (
            <Hit n={3}>
              <span className={s.chip}>¼ ½ {quarters}</span>
            </Hit>
          ) : (
            <span className={s.chip}>¼ ½ {quarters}</span>
          ))}
        <span className={s.btnLine}>−</span>
        <span style={{ minWidth: 44, textAlign: "center" }}>
          <b style={{ fontSize: 18 }}>{value}</b>
          <span className={s.small} style={{ display: "block" }}>
            {unit}
          </span>
        </span>
        <span className={s.btnLine}>+</span>
      </span>
    </div>
  );
}

export default function ParCountAndShoppingList() {
  return (
    <TrainingPage>
      <Need title="The short version">
        Par is how much of each thing we keep on hand. Count what&apos;s on the shelf in the unit shown, save it, and the shopping list writes itself. Something runs
        out mid-shift? Tap <b>Ran out</b> so the register stops selling it and it goes to the top of the list.
      </Need>

      <Step n={1} title="Open the par sheet from the register">
        <p>
          On the register, the shift bar along the top has <b>Par sheet</b>, <b>Shopping</b> and <b>Ran out</b>. Tap <b>Par sheet</b>. Pick the sheet you&apos;re counting
          (the bar, the kitchen, the stand); each button says how many are counted so far.
        </p>
      </Step>

      <Step n={2} title="Count in the unit shown, not in servings">
        <p>
          Every line says what it&apos;s counted in: <b>bottles</b>, <b>bags</b>, <b>boxes</b>, <b>gallons</b>. Count those, not drinks or scoops. Fully stocked? Tap{" "}
          <b>= par</b> and move on. Otherwise use <b>−</b> and <b>+</b>.
        </p>
        <Screen url={`${HOST}/pos`} caption="Register → Par sheet" label="Par sheet lines with counts; one is below par">
          <div className={`${s.card} ${s.cardFlush}`}>
            <Line name="Popcorn kernels" par="2 bags" last="3 bags" value="2" unit="bags" />
            <Line name="Nacho cheese" par="4 cans" last="4 cans" value="1" unit="cans" low="Below par: get 3 cans" />
            <Line name="Well vodka" par="3 bottles" last="3 bottles" value="2¾" unit="bottles" quarters="¾" />
          </div>
        </Screen>
        <Tip>
          A line turns yellow when it&apos;s under par and says how many to get. Your numbers stay on this iPad until you save, so stepping away (or a reload) doesn&apos;t
          lose them.
        </Tip>
      </Step>

      <Step n={3} title="Bottles count to the quarter">
        <p>
          Bottles, kegs, jugs and other things that get opened count in quarters. Count the full ones with <b>+</b>, then tap <b>¼</b>, <b>½</b> or <b>¾</b> for the open
          one. Two full bottles and one three-quarters full is <b>2¾</b>. Tap the lit one again to take it off.
        </p>
        <Screen url={`${HOST}/pos`} caption="Register → Par sheet" label="A bottle line with the three-quarters button highlighted, counting 2 and three quarters">
          <div className={`${s.card} ${s.cardFlush}`}>
            <Line name="Well vodka" par="3 bottles" last="3 bottles" value="2¾" unit="bottles" quarters="¾" ring="quarters" low="Below par by ¼ bottle: get 1 bottle" />
          </div>
        </Screen>
        <Tip>
          The shopping list rounds up to whole units, since you can&apos;t buy ¾ of a bottle: ¼ under par means buy 1.
        </Tip>
      </Step>

      <Step n={4} title="Save a section at a time if you like">
        <p>
          You don&apos;t have to count everything in one go. Count the candy and tap <b>Save count</b>, then the bar later. Everything saved the same business day (4 AM to 4
          AM) is merged, and the shopping list uses each item&apos;s latest count from today.
        </p>
        <Tip>
          Anything not counted today is listed at the bottom of the shopping list under <b>Not counted today</b>, so nothing quietly drops off.
        </Tip>
      </Step>

      <Step n={5} title="Something ran out mid-shift? Tap Ran out">
        <p>
          Tap <b>Ran out</b> on the shift bar and type what ran out: it searches the par sheet, and anything that isn&apos;t on it can be typed in as is. Under{" "}
          <b>Stop selling these?</b> tick the menu items that need it; items whose recipe uses it are ticked for you. Save: those buttons show <b>OUT</b> on the register,
          and the people who buy for the week get an email. You don&apos;t need to buy it: the register shows a quiet line saying who was emailed.
        </p>
        <Screen url={`${HOST}/pos`} caption="Register → Ran out" label="The Ran out sheet with a menu item ticked">
          <div className={s.card}>
            <h4 className={s.cardTitle}>Ran out</h4>
            <div className={s.row}>
              <b className={s.grow}>Nacho cheese</b>
              <span className={s.small}>Kitchen · Par 4 cans</span>
            </div>
            <div className={s.small} style={{ marginTop: 8 }}>
              Stop selling these?
            </div>
            <div className={s.row} style={{ marginTop: 4 }}>
              <Hit n={5} className={`${s.chip} ${s.chipOn}`}>
                ✓ Nachos
              </Hit>
              <span className={s.chip}>Loaded fries</span>
            </div>
          </div>
        </Screen>
        <Tip>
          Tapping an OUT button lets you sell it anyway (say a few were found in the back), or mark it back. When it&apos;s back, say whether more was bought, so the
          shopping list knows.
        </Tip>
      </Step>

      <Step n={6} title="Use the shopping list">
        <p>
          Tap <b>Shopping</b>. First comes whatever ran out, then everything under par, grouped by the store it&apos;s bought at, with how many to get. The buyers
          are emailed about anything that ran out and mark it back in stock in Back office. <b>Found some</b> or <b>False alarm</b> clears a Ran out report without
          buying anything.
        </p>
      </Step>
    </TrainingPage>
  );
}
