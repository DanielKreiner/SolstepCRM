import type { Metadata } from "next";
import { Firmenlogo } from "@/components/ui/Firmenlogo";
import {
  Unterlagen,
  type UnterlagenPunkt,
} from "@/app/(app)/einstellungen/Unterlagen";
import {
  einrichtungSession,
  linkPunkte,
  type LinkPunkt,
} from "@/lib/einrichtung/zugang";
import { BUCKET_UNTERLAGEN } from "@/lib/dateien/unterlagen";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  linkDateiEntfernen,
  linkDateiVermerken,
  linkDateiZiel,
  linkEntfaellt,
  linkSpeichern,
} from "./actions";

export const metadata: Metadata = { title: "Einrichtung" };

/*
 * Die Einrichtungsliste hinter einem signierten Link.
 *
 * Derselbe Bildschirm wie in den Einstellungen, nur ohne Anmeldung und
 * ohne Backoffice-Rahmen. Wer die Angaben hat, hat oft keinen Zugang:
 * den Kundenstamm exportiert der Steuerberater, den Resturlaub kennt die
 * Lohnverrechnung.
 *
 * Alles Lesen und Schreiben läuft über lib/einrichtung/zugang.ts und
 * app/einrichtung/[token]/actions.ts — dort schränkt jede Abfrage selbst
 * auf den Mandanten des Tokens ein. Diese Seite fügt keine eigene
 * Abfrage hinzu.
 */

/** Ein abgelaufener, widerrufener und erfundener Link sehen gleich aus. */
function Hinweis({ titel, text }: { titel: string; text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col justify-center px-4 py-10">
      <div className="rounded-panel border border-line bg-panel p-7 shadow-[var(--shadow)]">
        <h1 className="mb-2 text-[20px] font-semibold tracking-[-0.015em]">{titel}</h1>
        <p className="text-[14px] leading-[1.55] text-muted">{text}</p>
      </div>
    </main>
  );
}

export default async function EinrichtungSeite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await einrichtungSession(token);

  if (session === "zu-viele") {
    return (
      <Hinweis
        titel="Einen Moment"
        text="Es kamen zu viele Anfragen in kurzer Zeit. Bitte die Seite in einer Minute neu laden."
      />
    );
  }

  if (session === "ungueltig") {
    return (
      <Hinweis
        titel="Dieser Link gilt nicht mehr"
        text="Er ist abgelaufen oder wurde zurückgezogen. Bitte einen neuen Link anfordern."
      />
    );
  }

  const punkte = await linkPunkte(session.companyId);

  /*
   * Die Leseadressen der Dateien werden hier signiert. Der Bucket ist
   * privat, und ohne Signatur käme niemand an eine Datei — auch nicht
   * der, der sie selbst hochgeladen hat.
   */
  const pfade = punkte.flatMap((p) => p.dateien.map((d) => d.storagePath));
  const links = new Map<string, string>();
  if (pfade.length > 0) {
    const admin = createAdminClient();
    const { data: signiert } = await admin.storage
      .from(BUCKET_UNTERLAGEN)
      .createSignedUrls(pfade, 60 * 60);
    for (const s of signiert ?? []) {
      if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
    }
  }

  const fuerAnzeige: UnterlagenPunkt[] = punkte.map((p: LinkPunkt) => ({
    id: p.id,
    schluessel: p.schluessel,
    bereich: p.bereich,
    titel: p.titel,
    grund: p.grund,
    art: p.art as UnterlagenPunkt["art"],
    optionen: p.optionen,
    dringend: p.dringend,
    wert: p.wert,
    anmerkung: p.anmerkung,
    status: p.status as UnterlagenPunkt["status"],
    /* Über den Link steht kein Name dabei — es gibt kein Konto. */
    beantwortetVon: null,
    beantwortetAm: null,
    dateien: p.dateien.map((d) => ({
      id: d.id,
      dateiname: d.dateiname,
      groesseBytes: d.groesseBytes,
      link: links.get(d.storagePath) ?? null,
    })),
  }));

  const offen = fuerAnzeige.filter((p) => p.status === "offen").length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[920px] flex-col gap-[14px] p-[10px] sm:p-[14px]">
      <header className="flex flex-wrap items-center gap-4 rounded-panel border border-line bg-panel px-6 py-5 shadow-[var(--shadow)]">
        <Firmenlogo firma={session.companyName} logoUrl={session.logoUrl} />
        <div className="min-w-0">
          <h1 className="text-[19px] leading-tight font-semibold tracking-[-0.015em]">
            Einrichtung {session.companyName}
          </h1>
          <p className="text-[13px] text-muted">
            {offen === 0
              ? "Alles beisammen."
              : `${offen} ${offen === 1 ? "Punkt ist" : "Punkte sind"} noch offen.`}
          </p>
        </div>
      </header>

      <div className="rounded-panel border border-line bg-panel px-6 py-5 shadow-[var(--shadow)]">
        <p className="mb-5 max-w-[62ch] text-[13.5px] leading-[1.55] text-muted">
          Hier steht, was für den Start noch gebraucht wird. Reihenfolge ist egal,
          Lücken sind kein Problem — jede Eingabe wird sofort gespeichert, der Link
          lässt sich also mehrmals aufrufen. Dateien dürfen bis 25 MB groß sein,
          auch gescannt.
        </p>

        <Unterlagen
          punkte={fuerAnzeige}
          gesperrt={!session.schreibbar}
          aktionen={{
            speichern: linkSpeichern.bind(null, token),
            entfaellt: linkEntfaellt.bind(null, token),
            dateiZiel: linkDateiZiel.bind(null, token),
            dateiVermerken: linkDateiVermerken.bind(null, token),
            dateiEntfernen: linkDateiEntfernen.bind(null, token),
          }}
        />
      </div>

      <p className="px-2 pb-2 text-[12px] text-faint">
        Dieser Link gehört zu {session.companyName} und zeigt nur diese Liste.
        Bitte nicht weitergeben.
      </p>
    </main>
  );
}
