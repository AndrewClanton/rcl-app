// One-off: create a Supabase Auth user and link it to a new 'admin'
// employee row, for the first back-office login. Run again with a
// different EMAIL/PASSWORD/NAME to provision additional staff logins
// until a real "invite employee" admin screen exists.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const EMAIL = process.argv[2] ?? "andrewjclanton@gmail.com";
const PASSWORD = process.argv[3] ?? "admin";
const NAME = process.argv[4] ?? "Andrew";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: userRes, error: userErr } = await supabase.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
if (userErr) {
  console.error("createUser failed:", userErr.message);
  process.exit(1);
}
console.log(`Created auth user ${userRes.user.id} (${EMAIL})`);

const { data: employee, error: empErr } = await supabase
  .from("employees")
  .insert({ name: NAME, auth_user_id: userRes.user.id, role: "admin", pin_hash: "scrypt$726376705f736565645f73616c74$1e51f61dd18946a3fda261fc467d6c44b2af95f7abec1d2b237d14a27733d09f" })
  .select("id, name, role")
  .single();
if (empErr) {
  console.error("employee insert failed:", empErr.message);
  process.exit(1);
}
console.log(`Linked to employee ${employee.name} (${employee.role}), PIN 9999`);
