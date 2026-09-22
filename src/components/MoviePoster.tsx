import Image from "next/image";

export default function MoviePoster({
  posterUrl,
  title,
  sizes = "200px",
  priority = false,
}: {
  posterUrl: string | null;
  title: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div className="poster-frame">
      {posterUrl ? (
        <Image src={posterUrl} alt={`${title} poster`} fill sizes={sizes} className="object-cover" priority={priority} />
      ) : (
        <div className="poster-placeholder">
          <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2.5" y="4.5" width="19" height="15" rx="1.5" />
            <path d="M2.5 8.5h19M2.5 15.5h19M7 4.5v4M7 15.5v4M17 4.5v4M17 15.5v4" />
          </svg>
          <span className="line-clamp-2 text-[11px] font-medium leading-tight">{title}</span>
        </div>
      )}
    </div>
  );
}
