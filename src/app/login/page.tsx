import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { safePath } from "@/lib/safe-path";
import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  // Checking for a *staff* session specifically, not just any Supabase Auth
  // session -- a customer-only account (or a deactivated former employee)
  // has a real session but no employees row, and redirecting those to
  // /admin would immediately bounce right back here via requireStaff()'s
  // own redirect, looping forever.
  const session = await getStaffSession();
  if (session) {
    // Already signed in: on to where they were headed (the register sends
    // ?redirect=/pos), else the back office. Same-site paths only.
    const { redirect: to } = await searchParams;
    redirect(safePath(typeof to === "string" ? to : null) ?? "/admin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--background)" }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
