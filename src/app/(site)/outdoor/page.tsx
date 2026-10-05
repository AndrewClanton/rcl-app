import { permanentRedirect } from "next/navigation";

// The short link to share when people ask what's on the outdoor screen:
// royalecinemajoplin.com/outdoor goes to the showtimes, outdoor screen only.
export default function OutdoorPage() {
  permanentRedirect("/showtimes?screen=outdoor");
}
