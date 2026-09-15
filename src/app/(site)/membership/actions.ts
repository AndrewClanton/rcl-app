"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function submitMembershipSignup(fields: { name: string; email: string; phone: string }): Promise<void> {
  const name = fields.name.trim();
  const email = fields.email.trim();
  if (!name) throw new Error("Enter your name.");
  if (!email || !email.includes("@")) throw new Error("Enter a valid email.");

  const supabase = createAdminClient();

  const { data: existing } = await supabase.from("members").select("id").eq("email", email).maybeSingle();
  if (existing) throw new Error("An Insiders account already exists for that email. Ask staff to look it up for you in person.");

  const { error } = await supabase.from("members").insert({
    name,
    email,
    phone: fields.phone.trim() || null,
    tier: "Insiders",
    points: 0,
  });
  if (error) {
    if (error.code === "23505") throw new Error("An Insiders account already exists for that email. Ask staff to look it up for you in person.");
    throw error;
  }
}
