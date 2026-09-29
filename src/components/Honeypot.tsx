// A form field no person ever sees or fills in: moved off screen, skipped
// by Tab, hidden from screen readers, and named so browser autofill won't
// guess at it. Simple bots fill in every box they find, and the server
// turns those away (lib/public-form-guard.ts). Controlled, since these
// forms send their values from state rather than posting the form.
export default function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
      <label>
        Leave this blank
        <input type="text" name="rcl_confirm_hp" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
