import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/admin");

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-900">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
