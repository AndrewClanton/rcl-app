"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addEasterEggPicture, deleteEasterEggPicture } from "./actions";

export interface EasterEggPicture {
  id: string;
  name: string;
  url: string | null; // signed thumbnail link
  size: string | null; // as it prints
}

const ACCEPT = "image/jpeg,image/png,image/gif,image/webp";

// Drop pictures in (or pick several), see them, delete them. Each file goes
// up on its own, one after another, so one bad file doesn't stop the rest.
export default function EasterEggPictures({ pictures }: { pictures: EasterEggPicture[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function upload(files: File[]) {
    if (!files.length || progress) return;
    const problems: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress(`Adding ${i + 1} of ${files.length}…`);
      const fd = new FormData();
      fd.append("picture", files[i]);
      try {
        const r = await addEasterEggPicture(fd);
        if (!r.ok) problems.push(r.error);
      } catch {
        problems.push(`${files[i].name} didn't upload. Try again.`);
      }
    }
    setProgress(null);
    setErrors(problems);
    router.refresh();
  }

  async function remove(id: string) {
    setDeleting(id);
    try {
      const r = await deleteEasterEggPicture(id);
      setErrors(r.ok ? [] : [r.error]);
    } catch {
      setErrors(["Couldn't delete that picture. Try again."]);
    }
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div
        className="card flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed text-center"
        style={{ borderColor: dragging ? "var(--gold)" : "var(--border)" }}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") input.current?.click();
        }}
      >
        <span className="text-2xl" aria-hidden>
          🖼️
        </span>
        <span className="font-semibold">{progress ?? "Drop pictures here, or tap to choose"}</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          JPG, PNG, GIF or WebP, up to 8 MB each. Several at once is fine.
        </span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1 text-sm" role="alert" style={{ color: "var(--danger-text)" }}>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {pictures.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No pictures yet. Until there are, the register&apos;s button says to add some here first.
        </p>
      ) : (
        <>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {pictures.length} picture{pictures.length === 1 ? "" : "s"}.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {pictures.map((p) => (
              <figure key={p.id} className="card !p-2">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private bucket
                  <img src={p.url} alt={p.name} className="aspect-square w-full rounded object-contain" style={{ background: "#fff" }} />
                ) : (
                  <div className="aspect-square w-full rounded" style={{ background: "var(--border)" }} />
                )}
                <figcaption className="mt-1.5 flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate" title={p.name} style={{ color: "var(--muted)" }}>
                    {p.size ?? p.name}
                  </span>
                  <button className="shrink-0 hover:underline" style={{ color: "var(--danger-text)" }} disabled={deleting === p.id} onClick={() => void remove(p.id)}>
                    {deleting === p.id ? "Deleting…" : "Delete"}
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
