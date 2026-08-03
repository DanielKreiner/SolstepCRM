import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Aktionspanel } from "@/components/vorgang/Aktionen";
import { GateAmpel } from "@/components/vorgang/GateAmpel";
import { Stepper } from "@/components/vorgang/Stepper";
import { Positionen } from "@/components/vorgang/Positionen";
import { Strom } from "@/components/vorgang/Strom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { date, eur, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { vorgangDetail } from "@/lib/vorgang/daten";
import {
  PHASE_LABEL,
  offenePflichtGates,
  summen,
  tageInPhase,
} from "@/lib/vorgang/modell";
import { StammdatenForm } from "../VorgangForms";

export const metadata: Metadata = { title: "Vorgang" };

/**
 * Die Vorgangsansicht — der einzige Ort, an dem gearbeitet wird.
 *
 * Drei Zonen: Kopf mit Nummer, Kunde, Anlage, Stepper und Gate-Ampeln.
 * Links der Aktivitätsstrom mit Composer, rechts das Aktionspanel mit
 * genau einer nächsten Aktion, den Gates und den Stammdaten.
 *
 * Kein Absprung auf Unterseiten: was hier nicht steht, gibt es nicht.
 */
export default async function VorgangPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;

  const daten = await vorgangDetail(id);
  if (!daten) notFound();

  const { kopf, gates, events, positionen, termine, dokumente } = daten;
  const darfSchreiben = me.perms.pipelines === "write";
  const darfAngebote = me.perms.angebote !== "none";

  const offen = offenePflichtGates(gates);
  const s = summen(
    positionen.map((p) => ({
      menge: p.menge,
      epNetto: p.epNetto,
      ustSatz: p.ustSatz,
      kalkStunden: p.kalkStunden,
      kalkEk: p.kalkEk,
      istMaterial: p.istMaterial,
    })),
  );

  const tage = tageInPhase(kopf.phaseSeit, new Date());

  const supabase = await createClient();
  const [{ data: team }, { data: artikel }] = await Promise.all([
    supabase.from("app_user").select("id, name").eq("active", true).order("name"),
    supabase
      .from("article")
      .select("id, sku, name, sale_price, image_url")
      .eq("active", true)
      .order("name"),
  ]);

  /*
   * Der Editor steht nur im Vertrieb offen. Ab „beauftragt" ist der
   * Leistungsumfang vereinbart — Änderungen gehören in eine
   * Nachtragsposition, nicht rückwirkend ins Angebot.
   */
  const editorGesperrt = ["beauftragt", "montage", "abschluss", "verloren"].includes(
    kopf.phase,
  );

  const naechsterTermin = termine.find((t) => new Date(t.bis) >= new Date());

  return (
    <>
      <PageHeader
        title={kopf.number}
        subtitle={`${kopf.kundeName}${kopf.ort ? ` · ${kopf.ort}` : ""}`}
        actions={
          <Link
            href="/vorgaenge"
            className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
          >
            Zum Board
          </Link>
        }
      />

      {/* ---------------------------------------------------------- KOPF */}
      <section className="mb-4 rounded-[20px] bg-surface p-5 shadow-soft">
        <div className="mb-4 flex flex-wrap items-start gap-x-8 gap-y-3">
          <Kennwert label="Kunde" wert={kopf.kundeName} unter={kopf.kontakt} />
          <Kennwert
            label="Adresse"
            wert={kopf.adresse ?? "—"}
            unter={[kopf.plz, kopf.ort].filter(Boolean).join(" ") || null}
          />
          <Kennwert
            label="Anlage"
            wert={kopf.kwp ? num(kopf.kwp, "kWp") : "—"}
            unter={
              kopf.speicherKwh ? `${num(kopf.speicherKwh, "kWh")} Speicher` : "kein Speicher"
            }
          />
          <Kennwert
            label="Wert"
            /*
             * Kein Betrag heisst kein Betrag — nicht 0 €. Die Montage
             * sieht hier einen Strich, weil die View ihr keine Zeile
             * liefert, und 0 € wäre eine Aussage, und zwar eine falsche.
             */
            wert={
              !kopf.darfBetraege
                ? "—"
                : kopf.auftragswertNetto !== null
                  ? eur(kopf.auftragswertNetto)
                  : kopf.angebotswertNetto !== null
                    ? eur(kopf.angebotswertNetto)
                    : positionen.length > 0
                      ? eur(s.netto)
                      : "—"
            }
            unter={
              kopf.darfBetraege
                ? kopf.auftragswertNetto !== null
                  ? "Auftragswert netto"
                  : "Angebotswert netto"
                : "für diese Rolle nicht sichtbar"
            }
          />
          <Kennwert
            label="Zuständig"
            wert={kopf.zustaendigName ?? "offen"}
            unter={`seit ${tage} ${tage === 1 ? "Tag" : "Tagen"} in dieser Phase`}
          />
          {kopf.altNummern ? (
            <Kennwert
              label="Früher"
              wert={kopf.altNummern}
              unter="Nummern aus dem Altbestand"
            />
          ) : null}
        </div>

        <Stepper phase={kopf.phase} />

        {gates.length > 0 ? (
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-[12.5px] font-semibold text-muted">Gates</h2>
              {offen.length > 0 ? (
                <Pill tone="warn">
                  {offen.length} {offen.length === 1 ? "Pflicht offen" : "Pflichten offen"}
                </Pill>
              ) : (
                <Pill tone="done">alle Pflicht-Gates durch</Pill>
              )}
            </div>
            <GateAmpel
              vorgangId={kopf.id}
              gates={gates}
              gesperrt={!darfSchreiben}
            />
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------- STROM UND AKTIONEN */}
      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {darfAngebote ? (
            <Positionen
              vorgangId={kopf.id}
              positionen={positionen}
              gesperrt={editorGesperrt}
              gesperrtGrund={
                kopf.phase === "verloren"
                  ? "Der Vorgang ist verloren. Die Positionen bleiben zur Auswertung stehen."
                  : "Der Auftrag läuft bereits. Änderungen am Leistungsumfang gehören in eine Nachtragsposition."
              }
              artikel={(artikel ?? []).map((a) => ({
                wert: a.id as string,
                text: a.name as string,
                zusatz: `${a.sku as string} · ${eur(a.sale_price)}`,
                ...(a.image_url ? { bild: a.image_url as string } : {}),
              }))}
            />
          ) : null}

          <Strom
          vorgangId={kopf.id}
            eintraege={events}
            darfSchreiben={darfSchreiben}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Aktionspanel
            vorgangId={kopf.id}
            phase={kopf.phase}
            offeneGates={offen.map((g) => g.label)}
            darfSchreiben={darfSchreiben}
            verlorenGrund={kopf.verlorenGrund}
            anzahlungProzent={kopf.anzahlungProzent}
          />

          {naechsterTermin ? (
            <section className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="text-[15px] font-semibold">Nächster Termin</h2>
              <p className="num mt-2 text-[13.5px]">
                {date(naechsterTermin.von)} – {date(naechsterTermin.bis)}
              </p>
              <p className="mt-1 text-[12.5px] text-muted">
                {naechsterTermin.personen.length > 0
                  ? naechsterTermin.personen.join(", ")
                  : "noch niemand zugeordnet"}
                {naechsterTermin.subText ? ` · ${naechsterTermin.subText}` : ""}
              </p>
            </section>
          ) : null}

          {dokumente.length > 0 ? (
            <section className="rounded-[20px] bg-surface p-5 shadow-soft">
              <h2 className="mb-3 text-[15px] font-semibold">Dokumente</h2>
              <ul className="flex flex-col gap-2">
                {dokumente.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-input bg-panel px-4 py-3 text-[12.5px]"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">{d.dateiname}</span>
                      {d.status ? <Pill tone="neutral">{d.status}</Pill> : null}
                    </div>
                    <span className="num text-[11.5px] text-faint">
                      {d.nummer ? `${d.nummer} · ` : ""}
                      {kopf.darfBetraege && d.betragBrutto !== null
                        ? `${eur(d.betragBrutto)} brutto`
                        : date(d.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {darfSchreiben ? (
            <StammdatenForm
              werte={{
                vorgangId: kopf.id,
                kwp: kopf.kwp,
                speicherKwh: kopf.speicherKwh,
                adresse: kopf.adresse ?? "",
                plz: kopf.plz ?? "",
                ort: kopf.ort ?? "",
                zaehlpunkt: kopf.zaehlpunkt ?? "",
                zustaendigId: kopf.zustaendigId ?? "",
                anzahlungProzent: kopf.anzahlungProzent,
                wiedervorlageAm: kopf.wiedervorlageAm ?? "",
              }}
              team={(team ?? []).map((u) => ({
                wert: u.id as string,
                text: u.name as string,
              }))}
            />
          ) : null}

          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <h2 className="mb-2 text-[15px] font-semibold">Kontakt</h2>
            <dl className="flex flex-col gap-[7px] text-[13px]">
              <Zeile label="Ansprechpartner">{kopf.kontakt ?? "—"}</Zeile>
              <Zeile label="E-Mail">
                <span className="num break-all">{kopf.email ?? "—"}</span>
              </Zeile>
              <Zeile label="Telefon">
                <span className="num">{kopf.telefon ?? "—"}</span>
              </Zeile>
              <Zeile label="Zählpunkt">
                <span className="num break-all">{kopf.zaehlpunkt ?? "—"}</span>
              </Zeile>
              <Zeile label="Phase">{PHASE_LABEL[kopf.phase]}</Zeile>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}

function Kennwert({
  label,
  wert,
  unter,
}: {
  label: string;
  wert: string;
  unter: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
        {label}
      </div>
      <div className="num mt-[3px] text-[15px] font-semibold">{wert}</div>
      {unter ? (
        <div className="text-[11.5px] text-muted">{unter}</div>
      ) : null}
    </div>
  );
}

function Zeile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
