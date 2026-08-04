import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Aktionspanel } from "@/components/vorgang/Aktionen";
import { GateAmpel } from "@/components/vorgang/GateAmpel";
import { Stepper } from "@/components/vorgang/Stepper";
import { AufnahmeBlock, type AufnahmePunkt } from "@/components/vorgang/Aufnahme";
import { Positionen } from "@/components/vorgang/Positionen";
import { Postausgang, type MailZeile } from "@/components/vorgang/Postausgang";
import { Rechnungen } from "@/components/vorgang/Rechnungen";
import { Versand } from "@/components/vorgang/Versand";
import { Chat } from "@/components/vorgang/Chat";
import { Kunde } from "@/components/vorgang/Kunde";
import { Strom } from "@/components/vorgang/Strom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Reiter } from "@/components/ui/Reiter";
import { date, eur, num } from "@/lib/format";
import { requireMe } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";
import { ausBytea, entschluesseln } from "@/lib/mail/crypto";
import { chatLesen } from "@/lib/vorgang/chat";
import { vorgangDetail } from "@/lib/vorgang/daten";
import {
  offenePflichtGates,
  summen,
  tageInPhase,
} from "@/lib/vorgang/modell";
import { StammdatenForm } from "../VorgangForms";

export const metadata: Metadata = { title: "Vorgang" };

/**
 * Die Vorgangsansicht.
 *
 * Bisher stand hier alles gleichzeitig: Angebotseditor, Gespräch,
 * Verlauf, Rechnungen, Kundenstammdaten. Das waren über 300 KB Markup
 * auf einer Seite, und wer eine Zeit nachtragen wollte, scrollte an
 * einem offenen Angebotseditor vorbei.
 *
 * Jetzt sind es Reiter. Der Kopf bleibt stehen — Nummer, Kunde, Anlage,
 * Wert, Phase sind die Identität des Vorgangs und gelten überall. Alles
 * andere lädt nur, wenn sein Reiter offen ist: der Artikelstamm mit
 * seinen 469 Zeilen wird nicht mehr geholt, um ein Gespräch zu lesen.
 *
 * Der aktive Reiter steht in der URL (CLAUDE.md Abschnitt 10) — ein Link
 * auf das Angebot eines Vorgangs ist teilbar.
 */

const REITER = [
  "ueberblick",
  "aufnahme",
  "angebot",
  "kunde",
  "kommunikation",
  "belege",
] as const;
type ReiterKey = (typeof REITER)[number];

export default async function VorgangPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await requireMe();
  const { id } = await params;
  const { tab: tabRoh } = await searchParams;

  const daten = await vorgangDetail(id);
  if (!daten) notFound();

  const { kopf, gates, events, positionen, gruppen, termine, dokumente } = daten;
  const darfSchreiben = me.perms.pipelines === "write";
  const darfAngebote = me.perms.angebote !== "none";
  const darfRechnungen = me.perms.rechnungen !== "none";

  /*
   * Ein Reiter, den die Rolle nicht sehen darf, fällt weg — und wer ihn
   * per URL aufruft, landet im Überblick statt vor einer leeren Fläche.
   */
  const erlaubt = REITER.filter(
    (r) =>
      (r !== "angebot" || darfAngebote) &&
      (r !== "belege" || darfRechnungen) &&
      (r !== "kunde" || me.perms.crm !== "none"),
  );
  const tab: ReiterKey = erlaubt.includes(tabRoh as ReiterKey)
    ? (tabRoh as ReiterKey)
    : "ueberblick";

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

  /*
   * Jeder Reiter holt sich nur, was er zeigt. Der Artikelstamm ist der
   * teuerste Posten und wird ausschliesslich im Angebotseditor gebraucht.
   */
  const [{ data: team }, versand] = await Promise.all([
    tab === "ueberblick"
      ? supabase.from("app_user").select("id, name").eq("active", true).order("name")
      : Promise.resolve({ data: null }),
    tab === "angebot" || tab === "kommunikation"
      ? supabase
          .from("vorgang")
          .select("angebot_versendet_am, angebot_gesehen_am")
          .eq("id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

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
      </section>

      <Reiter
        aktiv={tab}
        eintraege={erlaubt.map((r) => ({
          key: r,
          label: LABEL[r] ?? r,
          href: `/vorgaenge/${id}?tab=${r}`,
          ...(ANZAHL(r, {
            positionen: positionen.length,
            dokumente: dokumente.length,
            gates: offen.length,
          }) ?? {}),
        }))}
      />

      {tab === "ueberblick" ? (
        <Ueberblick
          kopf={kopf}
          gates={gates}
          offen={offen}
          events={events}
          termine={termine}
          team={(team ?? []) as { id: string; name: string }[]}
          darfSchreiben={darfSchreiben}
        />
      ) : null}

      {tab === "aufnahme" ? <AufnahmeReiter id={id} darfSchreiben={darfSchreiben} /> : null}

      {tab === "angebot" ? (
        <AngebotReiter
          id={id}
          kopf={kopf}
          positionen={positionen}
          gruppen={gruppen}
          versendetAm={(versand?.data?.angebot_versendet_am as string | null) ?? null}
          gesehenAm={(versand?.data?.angebot_gesehen_am as string | null) ?? null}
        />
      ) : null}

      {tab === "kunde" ? <KundeReiter id={id} kundeId={kopf.kundeId} crm={me.perms.crm} /> : null}

      {tab === "kommunikation" ? (
        <KommunikationReiter id={id} darfSchreiben={darfSchreiben} />
      ) : null}

      {tab === "belege" ? (
        <BelegeReiter
          id={id}
          phase={kopf.phase}
          darfBetraege={kopf.darfBetraege}
          darfSchreiben={me.perms.rechnungen === "write"}
          dokumente={dokumente}
        />
      ) : null}
    </>
  );
}

const LABEL: Record<ReiterKey, string> = {
  ueberblick: "Überblick",
  aufnahme: "Aufnahme",
  angebot: "Angebot",
  kunde: "Kunde",
  kommunikation: "Gespräch",
  belege: "Belege",
};

function ANZAHL(
  r: ReiterKey,
  z: { positionen: number; dokumente: number; gates: number },
): { anzahl: number } | null {
  if (r === "angebot" && z.positionen > 0) return { anzahl: z.positionen };
  if (r === "belege" && z.dokumente > 0) return { anzahl: z.dokumente };
  if (r === "ueberblick" && z.gates > 0) return { anzahl: z.gates };
  return null;
}

/* ------------------------------------------------------------- ÜBERBLICK */

type Detail = Awaited<ReturnType<typeof vorgangDetail>>;
type Kopf = NonNullable<Detail>["kopf"];

function Ueberblick({
  kopf,
  gates,
  offen,
  events,
  termine,
  team,
  darfSchreiben,
}: {
  kopf: Kopf;
  gates: NonNullable<Detail>["gates"];
  offen: NonNullable<Detail>["gates"];
  events: NonNullable<Detail>["events"];
  termine: NonNullable<Detail>["termine"];
  team: { id: string; name: string }[];
  darfSchreiben: boolean;
}) {
  const naechsterTermin = termine.find((t) => new Date(t.bis) >= new Date());

  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        {gates.length > 0 ? (
          <section className="rounded-[20px] bg-surface p-5 shadow-soft">
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <h2 className="text-[15px] font-semibold">Gates</h2>
              {offen.length > 0 ? (
                <Pill tone="warn">
                  {offen.length} {offen.length === 1 ? "Pflicht offen" : "Pflichten offen"}
                </Pill>
              ) : (
                <Pill tone="done">alle Pflicht-Gates durch</Pill>
              )}
            </div>
            <GateAmpel vorgangId={kopf.id} gates={gates} gesperrt={!darfSchreiben} />
          </section>
        ) : null}

        <Strom vorgangId={kopf.id} eintraege={events} darfSchreiben={darfSchreiben} />
      </div>

      <div className="flex flex-col gap-4">
        <Aktionspanel
          vorgangId={kopf.id}
          phase={kopf.phase}
          offeneGates={offen.map((g) => g.label)}
          darfSchreiben={darfSchreiben}
          verlorenGrund={kopf.verlorenGrund}
          anzahlungProzent={kopf.anzahlungProzent}
          team={team}
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
            team={team.map((u) => ({ wert: u.id, text: u.name }))}
          />
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- ANGEBOT */

async function AngebotReiter({
  id,
  kopf,
  positionen,
  gruppen,
  versendetAm,
  gesehenAm,
}: {
  id: string;
  kopf: Kopf;
  positionen: NonNullable<Detail>["positionen"];
  gruppen: NonNullable<Detail>["gruppen"];
  versendetAm: string | null;
  gesehenAm: string | null;
}) {
  const supabase = await createClient();
  const [{ data: artikel }, { data: vorlagenRoh }, { data: kunde }, { count: portale }] =
    await Promise.all([
      supabase
        .from("article")
        .select(
          "id, sku, name, category, manufacturer, unit, purchase_price, sale_price, image_url, modul_wp",
        )
        .eq("active", true)
        .order("name"),
      supabase
        .from("angebot_vorlage")
        .select(
          "id, name, beschreibung, ziel_kwp, ist_standard, positionen:angebot_vorlage_position ( id )",
        )
        .order("ist_standard", { ascending: false })
        .order("name"),
      supabase.from("customer").select("email").eq("id", kopf.kundeId).maybeSingle(),
      supabase
        .from("portal_access")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", kopf.kundeId)
        .is("revoked_at", null),
    ]);

  /*
   * Der Editor steht nur im Vertrieb offen. Ab „beauftragt" ist der
   * Leistungsumfang vereinbart — Änderungen gehören in eine
   * Nachtragsposition, nicht rückwirkend ins Angebot.
   */
  const gesperrt = ["beauftragt", "montage", "abschluss", "verloren"].includes(
    kopf.phase,
  );

  return (
    <div className="flex flex-col gap-4">
      <Versand
        vorgangId={id}
        versendetAm={versendetAm}
        gesehenAm={gesehenAm}
        anzahlPositionen={positionen.length}
        kundeMail={(kunde?.email as string | null) ?? null}
        hatPortal={(portale ?? 0) > 0}
        gesperrt={gesperrt}
      />

      <Positionen
        vorgangId={id}
        positionen={positionen}
        gruppen={gruppen}
        rahmen={{
          ustSatz: kopf.ustSatz,
          rabattProzent: kopf.rabattProzent,
          lieferungNetto: kopf.lieferungNetto,
        }}
        gesperrt={gesperrt}
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
        produkte={(artikel ?? []).map((a) => ({
          id: a.id as string,
          name: a.name as string,
          hersteller: (a.manufacturer as string | null) ?? null,
          kategorie: (a.category as string | null) ?? null,
          ekNetto: a.purchase_price === null ? null : Number(a.purchase_price),
          vkNetto: Number(a.sale_price),
          bildUrl: (a.image_url as string | null) ?? null,
          modulWp: a.modul_wp === null ? null : Number(a.modul_wp),
        }))}
        vorlagen={(vorlagenRoh ?? []).map((v) => ({
          id: v.id as string,
          name: v.name as string,
          beschreibung: (v.beschreibung as string | null) ?? null,
          zielKwp: v.ziel_kwp === null ? null : Number(v.ziel_kwp),
          istStandard: v.ist_standard as boolean,
          anzahlPositionen: ((v.positionen ?? []) as unknown[]).length,
        }))}
        /* Was der Betrieb tatsächlich verwendet — keine erfundene Liste. */
        einheiten={[
          ...new Set(
            (artikel ?? [])
              .map((a) => a.unit as string | null)
              .filter((u): u is string => Boolean(u)),
          ),
        ].sort()}
        kategorien={[
          ...new Set(
            (artikel ?? [])
              .map((a) => a.category as string | null)
              .filter((k): k is string => Boolean(k)),
          ),
        ].sort()}
      />
    </div>
  );
}

/* -------------------------------------------------------------- AUFNAHME */

async function AufnahmeReiter({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const supabase = await createClient();

  const { data: liste } = await supabase
    .from("vorgang_checkliste")
    .select(
      `id, name, abgeschlossen_am,
       punkte:vorgang_checkliste_punkt (
         id, label, hinweis, typ, pflicht, eigen, sort,
         wert_text, wert_zahl, erledigt_am
       )`,
    )
    .eq("vorgang_id", id)
    .eq("art", "aufnahme")
    .limit(1)
    .maybeSingle();

  if (!liste) {
    return (
      <AufnahmeBlock vorgangId={id} aufnahme={null} darfSchreiben={darfSchreiben} />
    );
  }

  /*
   * Anhänge kommen aus vorgang_anhang — dieselbe Strecke wie im Chat,
   * inklusive Prüfung der Dateiart und entfernter GPS-Daten. Der Bucket
   * ist privat, also braucht jede Datei eine signierte Adresse.
   */
  const { data: anhaenge } = await supabase
    .from("vorgang_anhang")
    .select("id, checkliste_punkt_id, dateiname, mime, storage_path")
    .eq("vorgang_id", id)
    .not("checkliste_punkt_id", "is", null);

  const roh = (anhaenge ?? []) as unknown as {
    id: string;
    checkliste_punkt_id: string;
    dateiname: string;
    mime: string | null;
    storage_path: string;
  }[];

  const signiert = new Map<string, string>();
  if (roh.length > 0) {
    const { data } = await supabase.storage
      .from("job-photos")
      .createSignedUrls(roh.map((a) => a.storage_path), 60 * 60);
    for (const s of data ?? []) {
      if (s.path && s.signedUrl) signiert.set(s.path, s.signedUrl);
    }
  }

  const jePunkt = new Map<string, AufnahmePunkt["anhaenge"]>();
  for (const a of roh) {
    const l = jePunkt.get(a.checkliste_punkt_id) ?? [];
    l.push({
      id: a.id,
      name: a.dateiname,
      url: signiert.get(a.storage_path) ?? null,
      istBild: (a.mime ?? "").startsWith("image/"),
    });
    jePunkt.set(a.checkliste_punkt_id, l);
  }

  const punkte = ((liste.punkte ?? []) as unknown as {
    id: string;
    label: string;
    hinweis: string | null;
    typ: string;
    pflicht: boolean;
    eigen: boolean;
    sort: number;
    wert_text: string | null;
    wert_zahl: string | null;
    erledigt_am: string | null;
  }[])
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((p) => ({
      id: p.id,
      label: p.label,
      hinweis: p.hinweis,
      typ: p.typ,
      pflicht: p.pflicht,
      eigen: p.eigen,
      sort: p.sort,
      wertText: p.wert_text,
      wertZahl: p.wert_zahl === null ? null : Number(p.wert_zahl),
      erledigtAm: p.erledigt_am,
      anhaenge: jePunkt.get(p.id) ?? [],
    }));

  return (
    <AufnahmeBlock
      vorgangId={id}
      darfSchreiben={darfSchreiben}
      aufnahme={{
        id: liste.id as string,
        name: liste.name as string,
        abgeschlossenAm: (liste.abgeschlossen_am as string | null) ?? null,
        punkte,
      }}
    />
  );
}

/* ----------------------------------------------------------------- KUNDE */

async function KundeReiter({
  id,
  kundeId,
  crm,
}: {
  id: string;
  kundeId: string;
  crm: string | undefined;
}) {
  const supabase = await createClient();
  const [{ data: zugang }, { data: kundeRoh }, { data: anlageRoh }, { data: historie }] =
    await Promise.all([
      supabase
        .from("portal_access")
        .select("token_enc, expires_at, last_seen_at")
        .eq("customer_id", kundeId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("customer")
        .select(
          "id, name, type, contact_person, email, phone, address, zip, city, source, notes, deleted_at",
        )
        .eq("id", kundeId)
        .maybeSingle(),
      supabase
        .from("plant")
        .select("id, kwp, storage_kwh, modules, inverter, meter_point, commissioned_on")
        .eq("customer_id", kundeId)
        .order("kwp", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("contact_activity")
        .select("id, kind, body, created_at")
        .eq("customer_id", kundeId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

  if (!kundeRoh) return null;

  /*
   * Der Token liegt verschlüsselt. Ältere Zugänge tragen nur einen Hash —
   * für die gibt es keinen anzeigbaren Link, und das steht dann auch da,
   * statt einen kaputten auszugeben.
   */
  let portalLink: string | null = null;
  if (zugang?.token_enc) {
    try {
      const roh = ausBytea(zugang.token_enc);
      if (roh) portalLink = `${BRAND.domain}/portal/${entschluesseln(roh)}`;
    } catch {
      portalLink = null;
    }
  }

  return (
    <Kunde
      darfSchreiben={crm === "write"}
      kunde={{
        id: kundeRoh.id as string,
        name: kundeRoh.name as string,
        type: kundeRoh.type as string,
        contactPerson: (kundeRoh.contact_person as string | null) ?? null,
        email: (kundeRoh.email as string | null) ?? null,
        phone: (kundeRoh.phone as string | null) ?? null,
        address: (kundeRoh.address as string | null) ?? null,
        zip: (kundeRoh.zip as string | null) ?? null,
        city: (kundeRoh.city as string | null) ?? null,
        source: (kundeRoh.source as string | null) ?? null,
        notes: (kundeRoh.notes as string | null) ?? null,
        archiviert: kundeRoh.deleted_at !== null,
      }}
      anlage={
        anlageRoh
          ? {
              id: anlageRoh.id as string,
              kwp: anlageRoh.kwp === null ? null : Number(anlageRoh.kwp),
              storageKwh:
                anlageRoh.storage_kwh === null ? null : Number(anlageRoh.storage_kwh),
              modules: (anlageRoh.modules as string | null) ?? null,
              inverter: (anlageRoh.inverter as string | null) ?? null,
              meterPoint: (anlageRoh.meter_point as string | null) ?? null,
              commissionedOn: (anlageRoh.commissioned_on as string | null) ?? null,
            }
          : null
      }
      portal={
        zugang
          ? {
              gueltigBis: date(zugang.expires_at as string),
              zuletztGesehen: zugang.last_seen_at
                ? date(zugang.last_seen_at as string)
                : null,
              link: portalLink,
            }
          : null
      }
      vorgangId={id}
      portalLink={portalLink}
      historie={((historie ?? []) as unknown as {
        id: string;
        kind: string;
        body: string | null;
        created_at: string;
      }[]).map((a) => ({
        id: a.id,
        kind: a.kind,
        body: a.body,
        createdAt: a.created_at,
      }))}
    />
  );
}

/* --------------------------------------------------------- KOMMUNIKATION */

async function KommunikationReiter({
  id,
  darfSchreiben,
}: {
  id: string;
  darfSchreiben: boolean;
}) {
  const supabase = await createClient();

  /* Im Betrieb inklusive der internen Notizen. */
  const [chat, { data: mails }] = await Promise.all([
    chatLesen(supabase, id, { nurKundensicht: false }),
    supabase
      .from("v_vorgang_mail")
      .select(
        "id, art, subject, to_addrs, status, attempts, last_error, sent_at, created_at, erneut_zu",
      )
      .eq("vorgang_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const zeilen: MailZeile[] = ((mails ?? []) as unknown as {
    id: string;
    art: string | null;
    subject: string;
    to_addrs: string[];
    status: string;
    attempts: number;
    last_error: string | null;
    sent_at: string | null;
    created_at: string;
    erneut_zu: string | null;
  }[]).map((m) => ({
    id: m.id,
    art: m.art,
    betreff: m.subject,
    an: m.to_addrs ?? [],
    status: m.status,
    versuche: m.attempts,
    fehler: m.last_error,
    gesendetAm: m.sent_at,
    erstelltAm: m.created_at,
    erneutZu: m.erneut_zu,
  }));

  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
      <Chat
        vorgangId={id}
        nachrichten={chat.nachrichten.map((n) => ({
          id: n.id,
          autor: n.autor,
          autorName: n.autorName,
          body: n.body,
          intern: n.intern,
          createdAt: n.createdAt,
          anhaenge: n.anhaenge,
        }))}
        anfragen={chat.anfragen}
        darfSchreiben={darfSchreiben}
      />

      <Postausgang vorgangId={id} mails={zeilen} darfSchreiben={darfSchreiben} />
    </div>
  );
}

/* ---------------------------------------------------------------- BELEGE */

function BelegeReiter({
  id,
  phase,
  darfBetraege,
  darfSchreiben,
  dokumente,
}: {
  id: string;
  phase: string;
  darfBetraege: boolean;
  darfSchreiben: boolean;
  dokumente: NonNullable<Detail>["dokumente"];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr] xl:items-start">
      <Rechnungen
        vorgangId={id}
        phase={phase}
        darfSchreiben={darfSchreiben}
        belege={dokumente
          .filter((d) => d.typ === "anzahlungsrechnung" || d.typ === "schlussrechnung")
          .map((d) => ({
            id: d.id,
            typ: d.typ,
            nummer: d.nummer,
            betragBrutto: d.betragBrutto,
            status: d.status,
            faelligAm: d.faelligAm,
            bezahltAm: d.bezahltAm,
          }))}
      />

      <section className="rounded-[20px] bg-surface p-5 shadow-soft">
        <h2 className="mb-3 text-[15px] font-semibold">Dokumente</h2>
        {dokumente.length === 0 ? (
          <p className="text-[12.5px] text-muted">Noch nichts abgelegt.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dokumente.map((d) => (
              <li key={d.id} className="rounded-input bg-panel px-4 py-3 text-[12.5px]">
                <div className="flex flex-wrap items-baseline gap-2">
                  {/*
                    Nur die Arten, für die es eine Vorlage gibt. Eine
                    Materialliste als PDF wäre eine leere Seite mit
                    Briefkopf.
                  */}
                  {["ab", "anzahlungsrechnung", "schlussrechnung"].includes(d.typ) ? (
                    <a
                      href={`/api/pdf/vorgang/${id}?art=${d.typ}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-accent-ink underline"
                    >
                      {d.dateiname}
                    </a>
                  ) : (
                    <span className="font-semibold">{d.dateiname}</span>
                  )}
                  {d.status ? <Pill tone="neutral">{d.status}</Pill> : null}
                </div>
                <span className="num text-[11.5px] text-faint">
                  {d.nummer ? `${d.nummer} · ` : ""}
                  {darfBetraege && d.betragBrutto !== null
                    ? `${eur(d.betragBrutto)} brutto`
                    : date(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
      {unter ? <div className="text-[11.5px] text-muted">{unter}</div> : null}
    </div>
  );
}
