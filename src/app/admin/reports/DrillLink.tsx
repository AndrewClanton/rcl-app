"use client";

import { openDrill, switchDrill } from "./drill-nav";

// A figure on the Day report that opens its drill-down. A real link (so it
// can be opened in a new tab or copied), opened in place on a plain click.
// `replace`: a link inside an open drill-down, going to another one.
export default function DrillLink({ href, className = "", title, replace = false, children }: { href: string; className?: string; title?: string; replace?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      title={title}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (replace) switchDrill(href);
        else openDrill(href);
      }}
    >
      {children}
    </a>
  );
}
