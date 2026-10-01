"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Signs out this device only. The default ("global") ended the login on
// every device at once, so signing out of a shared login (the business
// Google account the register runs on) on a phone logged the register out
// too (Caleb, 10/1).
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
