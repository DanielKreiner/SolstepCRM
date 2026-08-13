"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import {
  planungAnlegen,
  type PlanungStatus,
  positionenAusPlanung,
} from "@/app/(app)/vorgaenge/planung-actions";

/*
 * Die Planung am Vorgang.
 *
 * Zwei Wege, und der Betrieb entscheidet, ob er überhaupt einen geht:
 * Für einen Speichertausch braucht niemand ein Dachmodell, für eine
 * Neuanlage schon. Deshalb steht hier kein Zwang, sondern ein Angebot —
 * und wenn eine Planung hängt, der kürzeste Weg von dort ins Angebot.
 *
 * „Geräte übernehmen" kopiert Module, Wechselrichter und Speicher mit
 * Preis aus dem Artikelstamm. Verknüpft wird nichts: Ein Angebot von
 * heute darf sich nicht ändern, weil nächstes Jahr ein Preis steigt.
 */

const LEER: PlanungStatus = { error: null, ok: null };

export function Planung({
  vorgangId,
  planung,
  darfPlanen,
  gesperrt,
}: {
  vorgangId: string;
  /** Verknüpfte Planung, falls es eine gibt. */
  planung: { id: string; name: string; kwp: number | null } | null;
  /** Ohne Schreibrecht im Planer gibt es den Knopf zum Anlegen nicht. */
  darfPlanen: boolean;
  /** Angebot bereits versendet — dann keine Positionen mehr einfügen. */
  gesperrt: boolean;
}) {
  const router = useRouter();
  const [anlegenStand, anlegen, legtAn] = useActionState(planungAnlegen, LEER);

  /*
   * Nach dem Anlegen die Seite neu holen.
   *
   * Die Aktion ruft `revalidatePath`, aber der Router hält die schon
   * gerenderte Seite im Speicher: Die Karte zeigte weiter „Planung
   * anlegen", obwohl die Planung längst dranhing — und ein zweiter
   * Klick hätte sie beinahe ein zweites Mal angelegt.
   */
  useEffect(() => {
    if (anlegenStand.id) router.refresh();
  }, [anlegenStand.id, router]);
  const [uebernahmeStand, uebernehmen, uebernimmt] = useActionState(positionenAusPlanung, LEER);
  const meldung = anlegenStand.error ?? uebernahmeStand.error ?? anlegenStand.ok ?? uebernahmeStand.ok;
  const fehler = Boolean(anlegenStand.error ?? uebernahmeStand.error);

  return (
    <section className="rounded-[20px] bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-extrabold">Planung</h2>
        {planung?.kwp ? (
          <span className="num text-[13px] tabular-nums text-muted">
            {planung.kwp.toFixed(2).replace(".", ",")} kWp
          </span>
        ) : null}
      </div>

      {planung ? (
        <>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted">
            {planung.name}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={`/planer/${planung.id}`}
              className="flex h-11 items-center rounded-[12px] border border-line bg-surface px-4 text-[13.5px] font-semibold text-ink transition-colors hover:border-accent"
            >
              Planung öffnen
            </Link>
            {!gesperrt ? (
              <form action={uebernehmen}>
                <input type="hidden" name="vorgangId" value={vorgangId} />
                <button
                  type="submit"
                  disabled={uebernimmt}
                  className="flex h-11 items-center rounded-[12px] bg-accent px-4 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-to disabled:opacity-50"
                >
                  {uebernimmt ? "Übernimmt …" : "Geräte ins Angebot übernehmen"}
                </button>
              </form>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 max-w-prose text-[13px] leading-[1.5] text-muted">
            Zu diesem Vorgang gibt es keine Planung. Für eine Neuanlage lohnt sie sich — Dach,
            Belegung und Ertrag stehen danach im Angebot. Für einen Tausch oder eine Reparatur
            kannst du sie weglassen.
          </p>
          {darfPlanen ? (
            <form action={anlegen} className="mt-3">
              <input type="hidden" name="vorgangId" value={vorgangId} />
              <button
                type="submit"
                disabled={legtAn}
                className="flex h-11 items-center rounded-[12px] border border-line bg-surface px-4 text-[13.5px] font-semibold text-ink transition-colors hover:border-accent disabled:opacity-50"
              >
                {legtAn ? "Legt an …" : "Planung anlegen"}
              </button>
            </form>
          ) : null}
        </>
      )}

      {meldung ? (
        <p
          className={[
            "mt-3 text-[12.5px] leading-[1.45]",
            fehler ? "font-semibold text-s-crit" : "text-muted",
          ].join(" ")}
        >
          {meldung}
        </p>
      ) : null}
    </section>
  );
}
