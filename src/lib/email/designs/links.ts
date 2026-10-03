import { SITE_URL } from "@/lib/site";

// The placeholders that give the ready-made emails' personal buttons a line
// in "Top links". The buttons themselves go straight to the person's own
// link (tagged e=<send id>); the claim page and /membership/finish record
// the click against these (lib/email/clicks.ts recordPersonalClick).
export const PERSONAL_CLAIM = `${SITE_URL}/account/claim#their-own-link`;
export const PERSONAL_FINISH = `${SITE_URL}/membership/finish#their-own-link`;
