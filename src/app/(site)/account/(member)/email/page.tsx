import { redirect } from "next/navigation";

// There are no email choices on the site (owner's call, 10/9): people
// unsubscribe from the email itself. Old links and bookmarks to the
// preference page go to the account page.
export default function AccountEmailPage(): never {
  redirect("/account");
}
