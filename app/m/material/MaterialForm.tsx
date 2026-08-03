"use client";

import { useState } from "react";
import { enqueue, flush } from "@/lib/offline/queue";

type Option = { id: string; label: string; unit: string };

export function MaterialForm({
  articles,
  jobs,
  fixedJobId,
}: {
  articles: Option[];
  jobs: { id: string; label: string }[];
  fixedJobId?: string;
}) {
  const [articleId, setArticleId] = useState(articles[0]?.id ?? "");
  const [jobId, setJobId] = useState(fixedJobId ?? jobs[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [art, setArt] = useState<"out" | "return">("out");
  const [meldung, setMeldung] = useState<string | null>(null);

  const einheit = articles.find((a) => a.id === articleId)?.unit ?? "";

  async function buchen() {
    const menge = Number(qty);
    if (!articleId || !Number.isFinite(menge) || menge <= 0) {
      setMeldung("Artikel und Menge fehlen.");
      return;
    }

    // Erst in die Warteschlange, dann optimistisch melden — auf dem Dach
    // gibt es kein Netz, aber die Buchung darf nicht verloren gehen.
    await enqueue("stock_move", {
      articleId,
      jobId: jobId || null,
      qty: menge,
      kind: art,
      note: null,
    });

    setMeldung(art === "out" ? "Entnahme erfasst." : "Rückgabe erfasst.");
    setQty("1");
    window.dispatchEvent(new Event("betrieb:queue"));
    void flush().then(() => window.dispatchEvent(new Event("betrieb:queue")));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-[6px]">
        <label
          htmlFor="m-article"
          className="text-[12.5px] font-semibold text-muted"
        >
          Artikel
        </label>
        <select
          id="m-article"
          value={articleId}
          onChange={(e) => setArticleId(e.target.value)}
          className="min-h-[56px] w-full rounded-input border border-transparent bg-surface px-4 text-[15px] outline-0 focus:border-accent"
        >
          {articles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {fixedJobId ? null : (
        <div className="flex flex-col gap-[6px]">
          <label
            htmlFor="m-job"
            className="text-[12.5px] font-semibold text-muted"
          >
            Vorgang
          </label>
          <select
            id="m-job"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="min-h-[56px] w-full rounded-input border border-transparent bg-surface px-4 text-[15px] outline-0 focus:border-accent"
          >
            <option value="">— ohne Vorgang —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-[6px]">
        <label
          htmlFor="m-qty"
          className="text-[12.5px] font-semibold text-muted"
        >
          Menge{einheit ? ` (${einheit})` : ""}
        </label>
        <input
          id="m-qty"
          type="number"
          inputMode="decimal"
          min="0.001"
          step="0.001"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="num min-h-[56px] w-full rounded-input border border-transparent bg-surface px-4 text-[17px] outline-0 focus:border-accent"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setArt("out")}
          className={`min-h-[56px] flex-1 rounded-input text-[15px] font-medium ${art === "out" ? "bg-accent text-white" : "bg-surface text-muted"}`}
        >
          Entnahme
        </button>
        <button
          type="button"
          onClick={() => setArt("return")}
          className={`min-h-[56px] flex-1 rounded-input text-[15px] font-medium ${art === "return" ? "bg-accent text-white" : "bg-surface text-muted"}`}
        >
          Rückgabe
        </button>
      </div>

      <button
        type="button"
        onClick={buchen}
        className="min-h-[64px] w-full cursor-pointer rounded-pill border-0 bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[17px] font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
      >
        Buchen
      </button>

      {meldung ? (
        <p role="status" className="text-center text-[13px] text-muted">
          {meldung}
        </p>
      ) : null}
    </div>
  );
}
