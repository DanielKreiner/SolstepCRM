/*
 * Demodaten für die Vorführung.
 *
 * Der Unterschied zwischen einer Software, die man kaufen will, und
 * einer, die man höflich anschaut, sind zwanzig Minuten Demodaten. Ein
 * leerer Saldoverlauf, eine Bedarfsliste ohne Deckungsstatus und ein
 * Cockpit mit lauter Nullen sagen nichts über das Produkt — sie sagen
 * nur, dass niemand damit gearbeitet hat.
 *
 * Was dieses Skript herstellt:
 *   - Zeitbuchungen über die letzten zehn Wochen, dicht in den letzten
 *     zwei. Daraus füllen sich Zeiterfassung, Stundenkonto und der
 *     Saldoverlauf.
 *   - Zwei Kontobewegungen (Auszahlung, Gutschrift) — ein Konto ohne
 *     Bewegung sieht aus, als könnte man es nicht bewegen.
 *   - Bedarfslisten mit ABSICHTLICH gemischtem Deckungsstatus: offen,
 *     bestellt, im Lager, geladen. Genau daran zeigt sich das Modul.
 *   - Eine abgeschickte Bestellung mit bestätigtem Termin und eine
 *     halb gelieferte.
 *
 * Ausführen:  pnpm seed:vorfuehrung
 *
 * Wiederholbar: alles Erzeugte trägt eine Marke und wird vorher
 * entfernt. Bestehende Vorgänge und Stammdaten bleiben unangetastet —
 * das Skript erfindet keine Kunden, es benutzt die vorhandenen.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";

/* Woran das Skript sein eigenes Werk wiedererkennt. */
const MARKE = "Demo-Vorführung";

function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [
          l.slice(0, l.indexOf("=")).trim(),
          l.slice(l.indexOf("=") + 1).trim(),
        ]),
    );
  } catch {
    return process.env as Record<string, string>;
  }
}

const env = { ...loadEnv(), ...process.env };

const admin: SupabaseClient = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Ein Tag in Ortszeit, n Tage vor heute. */
function tagVor(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Uhrzeit an einem Tag als UTC-Zeitstempel — Wien liegt im Sommer +2. */
function uhr(tag: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(`${tag}T00:00:00Z`);
  /*
   * Der Versatz kommt aus der Zone selbst und nicht aus einer festen
   * Zahl: eine Demo im Oktober darf nicht um eine Stunde verrutschen.
   */
  const probe = new Date(`${tag}T12:00:00Z`);
  const wien = new Date(probe.toLocaleString("en-US", { timeZone: "Europe/Vienna" }));
  const versatzMin = Math.round((wien.getTime() - probe.getTime()) / 60000);
  d.setUTCMinutes(d.getUTCMinutes() + (h ?? 0) * 60 + (m ?? 0) - versatzMin);
  return d.toISOString();
}

function istWerktag(tag: string): boolean {
  const wt = new Date(`${tag}T12:00:00Z`).getUTCDay();
  return wt >= 1 && wt <= 5;
}

async function main() {
  console.log("Demodaten für die Vorführung\n");

  const { data: users } = await admin
    .from("app_user")
    .select("id, name, role, weekly_hours")
    .eq("company_id", COMPANY_A)
    .eq("active", true);

  const team = (users ?? []) as {
    id: string;
    name: string;
    role: string;
    weekly_hours: number;
  }[];

  const monteure = team.filter((u) => u.role === "monteur" || u.role === "bauleitung");
  if (monteure.length === 0) throw new Error("Kein Monteur im Demomandanten.");

  await zeitenSeeden(monteure);
  await kontobewegungen(monteure);
  await materialSeeden();

  console.log("\nFertig. Der Demopfad steht.");
}

/* ------------------------------------------------------------- ZEITEN */

/**
 * Zehn Wochen Zeitbuchungen.
 *
 * Die letzten beiden Wochen sind vollständig und hängen an echten
 * Vorgängen — dort schaut man in der Demo hin. Davor genügt eine
 * Tagessumme je Werktag: sie füllt den Saldoverlauf, ohne die Liste
 * unlesbar zu machen.
 */
async function zeitenSeeden(
  monteure: { id: string; name: string; weekly_hours: number }[],
): Promise<void> {
  await admin
    .from("time_entry")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("note", `${MARKE}%`);

  const { data: vorgaenge } = await admin
    .from("vorgang")
    .select("id, number, phase")
    .eq("company_id", COMPANY_A)
    .in("phase", ["montage", "abschluss", "beauftragt"])
    /*
     * Keine Testvorgänge: die E2E-Läufe legen welche an und räumen sie
     * hinterher weg — Demodaten, die daran hängen, verschwinden mit.
     */
    .or("zaehlpunkt.is.null,zaehlpunkt.not.like.E2E%")
    .order("created_at", { ascending: false })
    .limit(6);

  const ziele = (vorgaenge ?? []) as { id: string; number: string }[];
  if (ziele.length === 0) throw new Error("Keine laufenden Vorgänge gefunden.");

  const zeilen: Record<string, unknown>[] = [];

  for (let tagIndex = 1; tagIndex <= 70; tagIndex++) {
    const tag = tagVor(tagIndex);
    if (!istWerktag(tag)) continue;

    const dicht = tagIndex <= 14;

    monteure.forEach((u, i) => {
      /*
       * Ein bisschen Streuung, sonst sieht jede Woche gleich aus und
       * niemand glaubt, dass hier jemand gearbeitet hat. Die Streuung
       * ist deterministisch — zweimal seeden ergibt dasselbe Bild.
       */
      const streu = ((tagIndex * 7 + i * 13) % 5) - 2;
      const beginn = 7 + (i % 2 === 0 ? 0 : 0.5);
      const stunden = 8 + streu * 0.25;

      const von = uhr(
        tag,
        `${String(Math.floor(beginn)).padStart(2, "0")}:${beginn % 1 ? "30" : "00"}`,
      );
      const bis = new Date(
        new Date(von).getTime() + stunden * 3600_000,
      ).toISOString();

      const vorgang = ziele[(tagIndex + i) % ziele.length]!;

      if (dicht) {
        /* Anfahrt und Arbeit getrennt — so bucht die Monteur-App auch. */
        const fahrtBis = new Date(new Date(von).getTime() + 40 * 60_000).toISOString();
        zeilen.push({
          company_id: COMPANY_A,
          user_id: u.id,
          vorgang_id: vorgang.id,
          kind: "travel",
          started_at: von,
          ended_at: fahrtBis,
          status: "approved",
          quelle: "monteur_app",
          /*
           * Auch auf der Fahrt gesetzt, obwohl sie null bleiben könnte:
           * PostgREST setzt bei einem Mehrzeilen-Insert jeden Schlüssel,
           * der nicht in JEDER Zeile steht, ausdrücklich auf null — die
           * Spaltenvorgabe greift dann nicht.
           */
          auto_break_min: 0,
          note: `${MARKE} Anfahrt ${vorgang.number}`,
        });
        zeilen.push({
          company_id: COMPANY_A,
          user_id: u.id,
          vorgang_id: vorgang.id,
          kind: "work",
          started_at: fahrtBis,
          ended_at: bis,
          status: tagIndex <= 3 ? "booked" : "approved",
          quelle: "monteur_app",
          auto_break_min: 30,
          note: `${MARKE} Montage ${vorgang.number}`,
        });
      } else {
        zeilen.push({
          company_id: COMPANY_A,
          user_id: u.id,
          vorgang_id: vorgang.id,
          kind: "work",
          started_at: von,
          ended_at: bis,
          status: "approved",
          quelle: "manuell",
          auto_break_min: 30,
          note: `${MARKE} Tagesarbeit`,
        });
      }
    });
  }

  /* In Blöcken, sonst wird die Anfrage zu gross. */
  for (let i = 0; i < zeilen.length; i += 200) {
    const { error } = await admin.from("time_entry").insert(zeilen.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(`  ${zeilen.length} Zeitbuchungen über zehn Wochen`);
}

/* ------------------------------------------------------- KONTOBEWEGUNG */

async function kontobewegungen(
  monteure: { id: string; name: string }[],
): Promise<void> {
  await admin
    .from("time_account_move")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("reason", `${MARKE}%`);

  const erste = monteure[0]!;
  const zweite = monteure[1] ?? erste;

  const { error } = await admin.from("time_account_move").insert([
    {
      company_id: COMPANY_A,
      user_id: erste.id,
      minutes: -480,
      kind: "auszahlung",
      reason: `${MARKE}: acht Überstunden im Juli ausbezahlt`,
    },
    {
      company_id: COMPANY_A,
      user_id: zweite.id,
      minutes: 120,
      kind: "gutschrift",
      reason: `${MARKE}: Rufbereitschaft am Wochenende`,
    },
  ]);
  if (error) throw error;

  console.log("  2 Kontobewegungen (Auszahlung, Gutschrift)");
}

/* ----------------------------------------------------------- MATERIAL */

/**
 * Bedarfslisten mit allen vier Deckungsstufen.
 *
 * Das ist der Kern der Vorführung: eine Liste, in der alles grün ist,
 * zeigt nichts. Erst wenn eine Position offen, eine bestellt, eine im
 * Lager und eine geladen ist, sieht man, wozu der Status da ist.
 */
async function materialSeeden(): Promise<void> {
  const { data: vorgaenge } = await admin
    .from("vorgang")
    .select("id, number, phase")
    .eq("company_id", COMPANY_A)
    .in("phase", ["beauftragt", "montage"])
    .or("zaehlpunkt.is.null,zaehlpunkt.not.like.E2E%")
    .order("created_at", { ascending: false })
    .limit(4);

  const ziele = (vorgaenge ?? []) as { id: string; number: string }[];
  if (ziele.length === 0) throw new Error("Keine beauftragten Vorgänge gefunden.");

  /* Vier Artikel, die im Katalog wirklich existieren. */
  const { data: artikelRoh } = await admin
    .from("article")
    .select("id, sku, name, unit, purchase_price")
    .eq("company_id", COMPANY_A)
    .eq("active", true)
    .eq("typ", "stueckliste")
    .gt("purchase_price", 0)
    .order("purchase_price", { ascending: false })
    .limit(4);

  const artikel = (artikelRoh ?? []) as {
    id: string;
    sku: string;
    name: string;
    unit: string;
  }[];
  if (artikel.length < 4) throw new Error("Zu wenige Artikel im Katalog.");

  const { data: ort } = await admin
    .from("lagerort")
    .select("id")
    .eq("company_id", COMPANY_A)
    .eq("art", "hauptlager")
    .single();
  const hauptlager = ort!.id as string;

  const { data: lieferant } = await admin
    .from("supplier")
    .select("id")
    .eq("company_id", COMPANY_A)
    .limit(1)
    .single();

  /* Aufräumen: alles, was dieses Skript zuletzt erzeugt hat. */
  for (const v of ziele) {
    await admin.from("vorgang_bedarf").delete().eq("vorgang_id", v.id);
  }
  const { data: alteBestellungen } = await admin
    .from("bestellung")
    .select("id")
    .eq("company_id", COMPANY_A)
    .like("notiz", `${MARKE}%`);
  for (const b of alteBestellungen ?? []) {
    await admin.from("lagerbewegung").delete().eq("bestellung_id", b.id);
    await admin.from("bestellposition").delete().eq("bestellung_id", b.id);
    await admin.from("bestellung").delete().eq("id", b.id);
  }
  await admin
    .from("lagerbewegung")
    .delete()
    .eq("company_id", COMPANY_A)
    .like("notiz", `${MARKE}%`);

  const ersterVorgang = ziele[0]!;
  const zweiterVorgang = ziele[1] ?? ersterVorgang;

  /* --- Vorgang 1: alle vier Stufen nebeneinander --- */
  const bedarf = artikel.map((a, i) => ({
    company_id: COMPANY_A,
    vorgang_id: ersterVorgang.id,
    artikel_id: a.id,
    bezeichnung: a.name,
    menge: [24, 1, 2, 6][i] ?? 4,
    einheit: a.unit,
    herkunft: "angebot",
    sort: i * 10,
  }));

  const { data: bedarfZeilen, error: bedarfFehler } = await admin
    .from("vorgang_bedarf")
    .insert(bedarf)
    .select("id, artikel_id, menge");
  if (bedarfFehler) throw bedarfFehler;

  const zeilen = bedarfZeilen ?? [];

  /* Stufe „geladen": schon auf den Vorgang gebucht. */
  const geladen = zeilen[0]!;
  await admin.from("lagerbewegung").insert([
    {
      company_id: COMPANY_A,
      artikel_id: geladen.artikel_id,
      typ: "wareneingang",
      nach_lagerort_id: hauptlager,
      menge: geladen.menge,
      notiz: `${MARKE} Anfangsbestand`,
    },
    {
      company_id: COMPANY_A,
      artikel_id: geladen.artikel_id,
      typ: "entnahme",
      von_lagerort_id: hauptlager,
      menge: geladen.menge,
      vorgang_id: ersterVorgang.id,
      notiz: `${MARKE} auf die Baustelle geladen`,
    },
  ]);

  /* Stufe „im Lager": Bestand da, noch nicht entnommen. */
  const imLager = zeilen[1]!;
  await admin.from("lagerbewegung").insert({
    company_id: COMPANY_A,
    artikel_id: imLager.artikel_id,
    typ: "wareneingang",
    nach_lagerort_id: hauptlager,
    menge: Number(imLager.menge) + 2,
    notiz: `${MARKE} Anfangsbestand`,
  });

  /* Stufe „bestellt": abgeschickte Bestellung mit bestätigtem Termin. */
  const bestellt = zeilen[2]!;
  const { data: b1 } = await admin
    .from("bestellung")
    .insert({
      company_id: COMPANY_A,
      nummer: `B-DEMO-1`,
      lieferant_id: lieferant!.id,
      status: "bestellt",
      bestellt_am: uhr(tagVor(4), "09:20"),
      notiz: `${MARKE}: Nachbestellung für ${ersterVorgang.number}`,
    })
    .select("id")
    .single();

  await admin.from("bestellposition").insert({
    company_id: COMPANY_A,
    bestellung_id: b1!.id,
    artikel_id: bestellt.artikel_id,
    bezeichnung: artikel.find((a) => a.id === bestellt.artikel_id)!.name,
    menge: bestellt.menge,
    einheit: artikel.find((a) => a.id === bestellt.artikel_id)!.unit,
    vorgang_id: ersterVorgang.id,
    bedarf_id: bestellt.id,
    /* Bestätigt und vor der Montage — damit zählt die Position als gedeckt. */
    bestaetigter_termin: tagVor(-3),
  });

  /* Stufe „offen": nichts angestossen. Genau die eine Zeile, die auffällt. */

  /* --- Vorgang 2: eine halb gelieferte Bestellung --- */
  const { data: bedarf2 } = await admin
    .from("vorgang_bedarf")
    .insert(
      artikel.slice(0, 2).map((a, i) => ({
        company_id: COMPANY_A,
        vorgang_id: zweiterVorgang.id,
        artikel_id: a.id,
        bezeichnung: a.name,
        menge: 20,
        einheit: a.unit,
        herkunft: "angebot",
        sort: i * 10,
      })),
    )
    .select("id, artikel_id, menge");

  const teil = (bedarf2 ?? [])[0];
  if (teil) {
    const { data: b2 } = await admin
      .from("bestellung")
      .insert({
        company_id: COMPANY_A,
        nummer: `B-DEMO-2`,
        lieferant_id: lieferant!.id,
        status: "teilgeliefert",
        bestellt_am: uhr(tagVor(9), "14:05"),
        notiz: `${MARKE}: Teillieferung für ${zweiterVorgang.number}`,
      })
      .select("id")
      .single();

    const { data: pos2 } = await admin
      .from("bestellposition")
      .insert({
        company_id: COMPANY_A,
        bestellung_id: b2!.id,
        artikel_id: teil.artikel_id,
        bezeichnung: artikel.find((a) => a.id === teil.artikel_id)!.name,
        menge: 20,
        einheit: artikel.find((a) => a.id === teil.artikel_id)!.unit,
        vorgang_id: zweiterVorgang.id,
        bedarf_id: teil.id,
        gelieferte_menge: 12,
        bestaetigter_termin: tagVor(-6),
      })
      .select("id")
      .single();

    await admin.from("lagerbewegung").insert({
      company_id: COMPANY_A,
      artikel_id: teil.artikel_id,
      typ: "wareneingang",
      nach_lagerort_id: hauptlager,
      menge: 12,
      bestellung_id: b2!.id,
      bestellposition_id: pos2!.id,
      notiz: `${MARKE} Teillieferung 12 von 20`,
    });
  }

  console.log(
    `  Bedarfslisten für ${ersterVorgang.number} (vier Deckungsstufen) und ${zweiterVorgang.number} (Teillieferung)`,
  );
  console.log("  2 Bestellungen, davon eine teilgeliefert");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
