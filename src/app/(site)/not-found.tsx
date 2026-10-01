import NotFoundSheet from "@/components/site/NotFoundSheet";

// A notFound() inside the public site, shown within the site's own header
// and footer. Whole-page loads of a missing address get app/not-found.tsx
// instead, which is the same sheet in the same frame, fully in the HTML.
export default function SiteNotFound() {
  return <NotFoundSheet />;
}
