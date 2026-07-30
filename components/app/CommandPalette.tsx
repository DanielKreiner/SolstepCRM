"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/Icon";

type Hit = { kind: string; id: string; label: string };

const KIND_LABEL: Record<string, string> = {
  job: "Auftrag",
  customer: "Kunde",
  article: "Artikel",
  quote: "Angebot",
};

const KIND_HREF: Record<string, (id: string) => string> = {
  job: (id) => `/auftraege/${id}`,
  customer: (id) => `/crm/${id}`,
  article: (id) => `/lager/${id}`,
  quote: (id) => `/angebote/${id}`,
};

/*
 * ⌘K auf jedem Screen. Quelle ist die View search_index — die läuft seit
 * Migration 0003 mit security_invoker, liefert also nur den eigenen Mandanten.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setCursor(0);
      queueMicrotask(() => inputRef.current?.focus());
    } else {
      setQ("");
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("search_index")
        .select("kind, id, label")
        .ilike("label", `%${term}%`)
        .limit(12);
      setHits((data ?? []) as Hit[]);
      setCursor(0);
      setLoading(false);
    }, 160);
    return () => clearTimeout(timer);
  }, [q]);

  const go = useCallback(
    (hit: Hit) => {
      const href = KIND_HREF[hit.kind]?.(hit.id);
      if (!href) return;
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  if (!open) return <PaletteTrigger onOpen={() => setOpen(true)} />;

  return (
    <>
      <PaletteTrigger onOpen={() => setOpen(true)} />
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(21,18,16,0.34)] p-4 pt-[12vh]"
        onClick={() => setOpen(false)}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Schnellsuche"
          className="w-full max-w-[560px] overflow-hidden rounded-card bg-surface shadow-soft"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-[10px] border-b border-line px-4 py-[13px]">
            <span className="text-faint">
              <Icon name="suche" size={17} />
            </span>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, hits.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                }
                if (e.key === "Enter") {
                  const hit = hits[cursor];
                  if (hit) go(hit);
                }
              }}
              placeholder="Auftrag, Kunde, Artikel suchen"
              className="flex-1 border-0 bg-transparent text-sm text-ink outline-0 placeholder:text-faint"
            />
            <kbd className="num rounded-lg bg-panel px-[7px] py-[3px] text-[11px] text-faint">
              esc
            </kbd>
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {q.trim().length < 2 ? (
              <p className="px-4 py-5 text-[13px] text-muted">
                Mindestens zwei Zeichen.
              </p>
            ) : loading ? (
              <div className="flex flex-col gap-2 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-input bg-sunk" />
                ))}
              </div>
            ) : hits.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-muted">Nichts gefunden.</p>
            ) : (
              hits.map((hit, i) => (
                <button
                  key={`${hit.kind}-${hit.id}`}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(hit)}
                  className={[
                    "flex w-full cursor-pointer items-center gap-3 border-0 px-4 py-[11px] text-left",
                    i === cursor ? "bg-sunk" : "bg-transparent",
                  ].join(" ")}
                >
                  <span className="num w-[68px] shrink-0 text-[10.5px] tracking-wide text-faint uppercase">
                    {KIND_LABEL[hit.kind] ?? hit.kind}
                  </span>
                  <span className="num flex-1 truncate text-[13.5px] text-ink">
                    {hit.label}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function PaletteTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex max-w-[520px] flex-1 cursor-pointer items-center gap-[10px] rounded-pill border-0 bg-panel px-4 py-[11px] text-left"
    >
      <span className="text-faint">
        <Icon name="suche" size={17} />
      </span>
      <span className="flex-1 truncate text-sm text-faint">
        Auftrag, Kunde, Artikel suchen
      </span>
      <span className="num hidden rounded-lg bg-surface px-[7px] py-[3px] text-[11px] text-faint sm:block">
        ⌘K
      </span>
    </button>
  );
}
