"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Adresssuche, type Ort } from "@/components/planer/Adresssuche";
import { Button } from "@/components/ui/Button";
import { projektAnlegen, type PlanerState } from "../actions";

/*
 * Einstieg wie im Prototyp: ein grosses Suchfeld, sonst nichts.
 *
 * Der Projektname zieht sich aus der gewählten Adresse — beim Kunden am
 * Tisch will niemand zwei Felder tippen. Überschreibbar bleibt er,
 * solange niemand ihn angefasst hat: sobald von Hand geändert, wird er
 * nicht mehr von der Adresse überschrieben.
 */

const LEER: PlanerState = { error: null, ok: null };

export function NeuFormular() {
  const router = useRouter();
  const [ort, setOrt] = useState<Ort | null>(null);
  const [name, setName] = useState("");
  const [selbstBenannt, setSelbstBenannt] = useState(false);
  const [stand, absenden, laeuft] = useActionState(projektAnlegen, LEER);

  useEffect(() => {
    if (stand.id) router.push(`/planer/${stand.id}`);
  }, [stand.id, router]);

  function gewaehlt(o: Ort) {
    setOrt(o);
    if (!selbstBenannt) {
      // Erster Abschnitt der Adresse ist in aller Regel Strasse und
      // Hausnummer — als Projektname brauchbarer als die volle Zeile.
      setName(o.name.split(",").slice(0, 2).join(",").trim());
    }
  }

  return (
    <form action={absenden} className="mx-auto w-full max-w-xl">
      <Adresssuche onWahl={gewaehlt} autoFocus />

      {ort ? (
        <div className="mt-6 rounded-card border border-line bg-surface p-4">
          <label className="block text-[12px] font-semibold text-muted" htmlFor="planer-name">
            Projektname
          </label>
          <input
            id="planer-name"
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSelbstBenannt(true);
            }}
            className="mt-1.5 h-10 w-full rounded-input border border-line bg-surface px-3 text-[14px] outline-none focus:border-accent"
            required
          />
          <p className="mono mt-3 text-[11.5px] tabular-nums text-muted">
            {ort.lat.toFixed(6)} / {ort.lon.toFixed(6)}
          </p>

          <input type="hidden" name="adresse" value={ort.name} />
          <input type="hidden" name="lat" value={ort.lat} />
          <input type="hidden" name="lon" value={ort.lon} />

          <div className="mt-4">
            <Button type="submit" disabled={laeuft}>
              {laeuft ? "Legt an …" : "Projekt anlegen"}
            </Button>
          </div>
        </div>
      ) : null}

      {stand.error ? (
        <p className="mt-4 text-center text-[13px] text-danger">{stand.error}</p>
      ) : null}
    </form>
  );
}
