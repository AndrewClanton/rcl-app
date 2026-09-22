import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  // Checking for a *staff* session specifically, not just any Supabase Auth
  // session -- a customer-only account (or a deactivated former employee)
  // has a real session but no employees row, and redirecting those to
  // /admin would immediately bounce right back here via requireStaff()'s
  // own redirect, looping forever.
  const session = await getStaffSession();
  if (session) redirect("/admin");

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--background)" }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
