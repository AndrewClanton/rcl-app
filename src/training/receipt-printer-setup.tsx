import { DoDont, Hit, Need, Screen, Step, Tip, TrainingPage, s } from "@/components/training/kit";
import { SITE_URL } from "@/lib/site";

// Setting up a receipt or kitchen printer (Back office -> Printers, and the
// printer's own settings page), for someone who isn't technical. The why
// first: the printer fetches its own jobs from the website (lib/print/
// queue.ts, app/api/print/poll), so the iPad never has to trust the
// printer's certificate. Change the steps? Bump the version in the catalog.
const POLL_URL = `${SITE_URL}/api/print/poll`;
const HOST = SITE_URL.replace(/^https?:\/\//, "");

// A box in the "how a receipt travels" drawing.
function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.card} style={{ textAlign: "center" }}>
      <b>{title}</b>
      <div className={s.small}>{children}</div>
    </div>
  );
}

// One line of the printer's settings, as the printer's page shows it.
function Field({ label, value, hit, n }: { label: string; value: string; hit?: boolean; n?: string | number }) {
  const box = <span className={`${s.input} ${s.filled} ${s.grow}`}>{value}</span>;
  return (
    <div className={s.row}>
      <span style={{ flex: "0 0 150px" }}>{label}</span>
      {hit ? (
        <Hit n={n} className={s.grow}>
          {box}
        </Hit>
      ) : (
        box
      )}
    </div>
  );
}

export default function ReceiptPrinterSetup() {
  return (
    <TrainingPage>
      <Need title="Before you start">
        The printer, plugged into power and into the theater&apos;s network with an Ethernet cable. A manager login for the back office. And a phone or computer on the
        theater&apos;s Wi-Fi to open the printer&apos;s settings page. About 15 minutes.
      </Need>

      <Step n={1} title="The big idea: the printer fetches its own jobs">
        <p>
          Our printers don&apos;t wait for the iPad to send them anything. The register hands each receipt to the website, and every few seconds the printer asks the
          website &quot;anything for me?&quot; and prints what&apos;s waiting. Think of the website as a mailbox the printer keeps checking.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 8, alignItems: "center" }} role="img" aria-label="Register sends the job to the website; the printer collects it from the website">
          <Box title="Register">rings the sale</Box>
          <span className={s.arrow}>→</span>
          <Box title="Website">holds the job</Box>
          <span className={s.arrow}>←</span>
          <Box title="Printer">asks every few seconds</Box>
        </div>
        <p>
          <b>Why it matters:</b> in the old setup the iPad talked to the printer directly, and first had to trust the printer&apos;s security certificate (its ID card).
          After an update or a restart the iPad would forget it, and printing stopped until someone found the right screen to accept it again. Now the iPad only talks to
          the website, so there&apos;s nothing to accept, ever.
        </p>
        <DoDont
          okTitle="Now: through the website"
          noTitle="Before: straight to the printer"
          ok={[
            <>Nothing to accept on the iPad</>,
            <>Keeps working after updates and restarts</>,
            <>A printer that was off picks up what&apos;s still waiting when it&apos;s back</>,
            <>Each register can print without being on the same network as the printer</>,
          ]}
          no={[
            <>Every iPad had to accept each printer&apos;s certificate</>,
            <>Broke after updates, restarts and new iPads</>,
            <>A printer that was off lost whatever was sent to it</>,
          ]}
        />
      </Step>

      <Step n={2} title="Add the printer in the back office">
        <p>
          In the back office, open <b>Printers</b> (managers only) and tap <b>Add printer</b>. Give it a name and say where it is. Under <b>What kind</b>, pick the new Epson.
          Under <b>What it prints</b>, pick the receipts it&apos;s for (Bar or Outdoor stand), or tick <b>Kitchen order tickets</b>. Leave &quot;Checks in every&quot; on 5
          seconds, and tap <b>Save</b>.
        </p>
        <Screen url={`${HOST}/admin/printers`} caption="Back office → Printers → Add printer" label="The Add a printer form with the Epson kind, Bar receipts and Save highlighted">
          <div className={s.card}>
            <h4 className={s.cardTitle}>Add a printer</h4>
            <div style={{ display: "grid", gap: 10 }}>
              <div className={s.row}>
                <span className={`${s.input} ${s.filled} ${s.grow}`}>Bar printer</span>
                <span className={`${s.input} ${s.filled} ${s.grow}`}>Bar, by the register</span>
              </div>
              <div>
                <div className={s.small}>What kind</div>
                <Hit n="a">◉ A new Epson (TM-m30II-H or TM-m30III) that collects its own jobs</Hit>
                <div className={s.dim}>○ The old TM-m30 at the bar, through the Raspberry Pi relay</div>
              </div>
              <div>
                <div className={s.small}>What it prints</div>
                <div className={s.row} style={{ marginTop: 4 }}>
                  <span className={s.chip}>No receipts</span>
                  <Hit n="b" className={`${s.chip} ${s.chipOn}`}>
                    Bar receipts
                  </Hit>
                  <span className={s.chip}>Outdoor stand receipts</span>
                </div>
                <div className={s.small} style={{ marginTop: 4 }}>
                  ☐ Kitchen order tickets (every order from both registers)
                </div>
              </div>
              <div className={s.row}>
                <Hit n="c" className={s.btnRed}>
                  Save
                </Hit>
                <span className={s.btnLine}>Cancel</span>
              </div>
            </div>
          </div>
        </Screen>
        <Tip>
          <b>One printer per job.</b> Giving this printer the Bar receipts takes them off any other printer, so two printers never print the same receipt.
        </Tip>
      </Step>

      <Step n={3} title="Leave the settings panel open: the password shows once">
        <p>
          After Save, a <b>Set up</b> panel shows everything to type into the printer, including a password it shows <b>only now</b>. Keep this page open until the
          printer is done. The password is long (24 letters and numbers), so each line has a <b>Copy</b> button: open the printer&apos;s page on the same device and paste.
        </p>
        <Screen url={`${HOST}/admin/printers`} caption="The Set up panel, right after Save" label="The Set up panel listing the Server Direct Print settings, with the password highlighted">
          <div className={s.card}>
            <h4 className={s.cardTitle}>Set up Bar printer</h4>
            <div className={s.small} style={{ background: "var(--warn-bg)", color: "var(--warn-tx)", padding: "6px 8px", borderRadius: 6 }}>
              The password is shown only now. Type it into the printer before you close this.
            </div>
            <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
              <div className={s.row}>
                <span className={s.dim} style={{ flex: "0 0 150px" }}>
                  Server 1: URL
                </span>
                <span>{POLL_URL}</span>
              </div>
              <div className={s.row}>
                <span className={s.dim} style={{ flex: "0 0 150px" }}>
                  ID
                </span>
                <span>rcl-7q2k…</span>
              </div>
              <div className={s.row}>
                <span className={s.dim} style={{ flex: "0 0 150px" }}>
                  Password
                </span>
                <Hit n={3}>
                  <span style={{ color: "var(--red)" }}>••••••••••••</span>
                </Hit>
              </div>
            </div>
          </div>
        </Screen>
        <Tip>
          <b>Closed it too soon?</b> No harm done. On the printer&apos;s card, tap <b>New password</b> and a new one is shown. The old one stops working at once.
        </Tip>
      </Step>

      <Step n={4} title="Find the printer's address on the network">
        <p>
          When the printer is plugged into the network and turned on, it prints a slip with its <b>IP address</b>, four numbers with dots, like <b>10.0.0.182</b>. No slip?
          Print a status sheet: open the paper cover, hold the <b>Feed</b> button until it starts printing (a second or so), and close the cover.
        </p>
      </Step>

      <Step n={5} title="Open the printer's own settings page">
        <p>
          On a phone or computer on the theater&apos;s Wi-Fi, type <b>http://</b> and the IP address into the browser&apos;s address bar, like <b>http://10.0.0.182</b>.
          The browser may warn that the page isn&apos;t secure: that&apos;s only about the printer&apos;s own page, on that device. Tap <b>Advanced</b>, then{" "}
          <b>Continue</b> (or <b>Visit this website</b>).
        </p>
        <p>
          Log in to <b>Advanced Settings</b>. The password is the printer&apos;s <b>serial number</b>, on the label underneath it, unless someone changed it.
        </p>
        <Tip>
          This is the only time anything asks you to &quot;continue anyway&quot;, and it&apos;s just for setting up. The registers never see this page.
        </Tip>
      </Step>

      <Step n={6} title="Check that ePOS-Print is on">
        <p>
          In the printer&apos;s menu, open <b>TM-Intelligent</b> and make sure <b>ePOS-Print</b> says <b>Enable</b>. It&apos;s how the printer understands the jobs
          we send it.
        </p>
      </Step>

      <Step n={7} title="Fill in Server Direct Print">
        <p>
          Open <b>Server Direct Print</b>. Set it to <b>Enable</b> and fill in <b>Server 1</b> exactly as the Set up panel shows. Leave Server 2 and Server 3 off.
        </p>
        <Screen url="http://10.0.0.182" caption="Drawn loosely · the printer's page may look a little different" label="The printer's Server Direct Print page with the Server 1 settings filled in and Access Test highlighted">
          <div className={s.card}>
            <h4 className={s.cardTitle}>Server Direct Print</h4>
            <div style={{ display: "grid", gap: 6 }}>
              <Field label="Server Direct Print" value="Enable" />
              <Field label="Server 1: URL" value={POLL_URL} hit n="7a" />
              <Field label="Interval (s)" value="5" />
              <Field label="ID" value="rcl-7q2k…" hit n="7b" />
              <Field label="Password" value="••••••••••••" hit n="7c" />
              <Field label="Name" value="Bar-printer" />
              <Field label="URL Encode" value="Enable" />
              <Field label="Server Authentication" value="Enable" />
              <div className={s.row}>
                <Hit n={8} className={s.btnLine}>
                  Access Test
                </Hit>
                <span className={s.btnRed}>Set</span>
              </div>
            </div>
          </div>
        </Screen>
      </Step>

      <Step n={8} title="Press Access Test, then Set">
        <p>
          <b>Access Test</b> (next to Server 1) checks that the printer can reach the website and log in with its ID and password. When it passes, press <b>Set</b>. The
          printer may restart; give it a minute.
        </p>
        <Tip>
          Access Test failed? Skip to <b>If something&apos;s wrong</b> at the end.
        </Tip>
      </Step>

      <Step n={9} title="Back in Printers: wait for Online, then Test print">
        <p>
          Within a minute, the printer&apos;s card on the Printers page should say <b>Online</b> in green. Tap <b>Test print</b>: a test page comes out a few seconds later.
        </p>
        <Screen url={`${HOST}/admin/printers`} caption="Back office → Printers" label="A printer card showing Online, with Test print highlighted">
          <div className={s.card}>
            <div className={s.row} style={{ justifyContent: "space-between" }}>
              <div>
                <b>Bar printer</b>
                <div className={s.small}>Bar · Epson, Server Direct Print · ID rcl-7q2k…</div>
                <div>Prints: Bar receipts, tickets &amp; drawer</div>
              </div>
              <Hit n="9a">
                <b style={{ color: "var(--ok-tx)" }}>Online</b>
              </Hit>
            </div>
            <div className={s.row} style={{ marginTop: 8 }}>
              <Hit n="9b" className={s.btnLine}>
                Test print
              </Hit>
              <span className={s.btnLine}>Edit</span>
              <span className={s.btnLine}>New password</span>
            </div>
          </div>
        </Screen>
        <p>What the status means:</p>
        <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
          <li>
            <b>Online</b>: it asked for work in the last minute or so. All good.
          </li>
          <li>
            <b>Last seen 12 min ago</b>: it stopped asking. It&apos;s off, unplugged, off the network, or its password changed.
          </li>
          <li>
            <b>Never connected</b>: it has never logged in, so what was typed into it is wrong, or Set wasn&apos;t pressed.
          </li>
        </ul>
      </Step>

      <Step n={10} title="On each register: pick its station and print through the website">
        <p>
          On the register iPad, tap <b>Devices</b>. Under <b>Which register is this?</b> pick <b>Bar</b> or <b>Outdoor stand</b>. Under <b>Receipt printer</b> pick{" "}
          <b>Print through the website</b>, then <b>Print a test page</b>. These choices are saved on that iPad, so do it once on each register.
        </p>
        <Screen url={`${HOST}/pos`} caption="Register → Devices" label="The Devices panel with Bar selected and Print through the website highlighted">
          <div className={s.card}>
            <h4 className={s.cardTitle}>This register&apos;s devices</h4>
            <div className={s.small}>Which register is this?</div>
            <div className={s.row} style={{ marginTop: 4 }}>
              <Hit n="10a" className={`${s.chip} ${s.chipOn}`}>
                Bar
              </Hit>
              <span className={s.chip}>Outdoor stand</span>
            </div>
            <div className={s.small} style={{ marginTop: 10 }}>
              Receipt printer
            </div>
            <Hit n="10b">◉ Print through the website to the Bar printer</Hit>
            <div className={s.dim}>○ Print straight to a printer IP (the old way)</div>
            <div className={s.small} style={{ marginTop: 6 }}>
              Bar printer · <span style={{ color: "var(--ok-tx)" }}>Online</span>
            </div>
            <div className={s.row} style={{ marginTop: 8 }}>
              <Hit n="10c" className={s.btnLine}>
                Print a test page
              </Hit>
              <span className={s.btnLine}>Open cash drawer</span>
            </div>
          </div>
        </Screen>
        <Tip>
          The station is also printed on the kitchen&apos;s tickets, so they know whether the food goes to the bar or the outdoor stand.
        </Tip>
      </Step>

      <Step n={11} optional title="The bar's old printer: the Pi relay">
        <p>
          The bar&apos;s original <b>TM-m30</b> is too old to check the website by itself. A small <b>Raspberry Pi</b> computer on the same network does the checking for
          it: every few seconds it asks the website for the bar&apos;s jobs and hands them to the printer. To the website it&apos;s just another printer, with its own ID
          and password.
        </p>
        <p>
          To set it up, <b>Add printer</b> with the kind <b>The old TM-m30 at the bar, through the Raspberry Pi relay</b>. The Set up panel then shows a block of settings
          for the Pi instead. Putting them on the Pi takes a keyboard or a laptop; the step-by-step is in the project&apos;s <b>scripts/pi-print-relay/README.md</b>, so
          ask Andrew if it&apos;s ever needed.
        </p>
        <Tip>
          <b>Bar printer offline?</b> Check that both the Pi and the printer are plugged in and on. The Pi starts the relay by itself when it boots.
        </Tip>
      </Step>

      <Step n={12} title="If something's wrong">
        <div className={s.two}>
          <div className={s.card}>
            <h4 className={s.cardTitle}>Access Test fails</h4>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              <li>
                <b>Certificate or SSL error:</b> on the printer&apos;s page, Network Security → Root Certificate Update → Update. Also check the date and time under
                Device Management.
              </li>
              <li>
                <b>Authentication error:</b> check the ID and password were typed exactly. If they&apos;re right and it still fails, add <b>?auth=basic</b> to the end of
                the Server 1 URL.
              </li>
              <li>
                <b>Can&apos;t connect:</b> the printer needs the internet. Check its network cable, and that it printed an IP address.
              </li>
            </ul>
          </div>
          <div className={s.card}>
            <h4 className={s.cardTitle}>After it&apos;s set up</h4>
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              <li>
                <b>&quot;Last seen&quot;, not Online:</b> check power, paper and the network cable. Still stuck? Tap New password and type the new one into the printer.
              </li>
              <li>
                <b>A receipt shows Expired:</b> the printer was off for more than 10 minutes, so it was dropped on purpose. Tap Reprint under Recent print jobs.
              </li>
              <li>
                <b>The register says no printer is set up:</b> no printer prints that station&apos;s receipts. Check What it prints on the Printers page.
              </li>
            </ul>
          </div>
        </div>
      </Step>
    </TrainingPage>
  );
}
