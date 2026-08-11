"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";
import { type PlanerState, projektDuplizieren } from "./actions";
import { num } from "@/lib/format";

/*
 * Eine Planung im Kartenraster (Briefing 8.3).
 *
 * Das Bild trägt die Karte — ein Dach erkennt man schneller als einen
 * Projektnamen. Fehlt es, treten die Kennzahlen an seine Stelle statt
 * einer leeren Fläche.
 */

const LEER: PlanerState = { error: null, ok: null };

export function ProjektKarte({
  id,
  name,
  adresse,
  kwp,
  bild,
  vorgangNummer,
  vorgangId,
  schreibrecht,
}: {
  id: string;
  name: string;
  adresse: string | null;
  kwp: number;
  bild: string | null;
  vorgangNummer: string | null;
  vorgangId: string | null;
  schreibrecht: boolean;
}) {
  const [stand, duplizieren, laeuft] = useActionState(projektDuplizieren, LEER);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-accent">
      <Link href={`/planer/${id}`} className="block">
        <div className="relative flex h-32 items-center justify-center overflow-hidden bg-pl-flaeche">
          {bild ? (
            <Image
              src={bild}
              alt={`Belegung ${name}`}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, 33vw"
              className="object-cover"
            />
          ) : (
            <span className="num text-[12px] text-pl-auf-dunkel-3">
              {kwp > 0 ? `${num(kwp)} kWp` : "noch keine Belegung"}
            </span>
          )}
        </div>

        <div className="px-3.5 pb-2.5 pt-3">
          <p className="truncate text-[14px] font-semibold">{name}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-muted">{adresse ?? "ohne Adresse"}</p>
          <p className="num mt-2 text-[11.5px] text-muted">
            {kwp > 0 ? `${num(kwp)} kWp · ` : ""}
            {vorgangNummer ? (
              <span className="font-semibold text-s-done">übergeben als {vorgangNummer}</span>
            ) : (
              "Entwurf"
            )}
          </p>
        </div>
      </Link>

      <div className="flex items-center gap-3 border-t border-line px-3.5 py-2">
        {vorgangId ? (
          <Link
            href={`/vorgaenge/${vorgangId}`}
            className="text-[12px] text-accent-ink hover:underline"
          >
            Vorgang
          </Link>
        ) : null}
        {schreibrecht ? (
          <form action={duplizieren} className="ml-auto">
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              disabled={laeuft}
              className="text-[12px] text-muted hover:text-ink disabled:opacity-50"
            >
              {laeuft ? "kopiert …" : "duplizieren"}
            </button>
          </form>
        ) : null}
      </div>

      {stand.error ? (
        <p className="px-3.5 pb-2 text-[11.5px] font-semibold text-s-crit">{stand.error}</p>
      ) : null}
    </div>
  );
}
