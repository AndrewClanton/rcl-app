"use client";

import { useState } from "react";
import { signOut } from "./actions";

export default function SignOutButton() {
  const [pending, setPending] = useState(false);
  return (
    <button
      className="btn-secondary"
      disabled={pending}
      onClick={() => {
        setPending(true);
        signOut();
      }}
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
