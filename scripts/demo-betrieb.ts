/*
 * Der laufende Betrieb im Demobestand: Lager, Bestellungen, Bedarf,
 * Planung, Zeiten, Abwesenheiten, Anliegen.
 *
 * Alles hier hängt an den Vorgängen aus demo-inhalt und macht aus
 * Stammdaten einen Betrieb, der arbeitet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kunde, Person } from "./demo-neu";
import type { VorgangDemo } from "./demo-inhalt";

type Ctx = {
  db: SupabaseClient;
  company: string;
  kunden: Kunde[];
  leute: Person[];
  hauptlager: string;
  fahrzeuge: { id: string; name: string; lagerortId: string | null }[];
  uhr: (t: string, hhmm: string) => string;
  tag: (n: number) => string;
  plus: (t: string, n: number) => string;
  montag: () => string;
  istWerktag: (t: string) => boolean;
};

/* ---------------------------------------------------------------- LAGER */

/**
 * Anfangsbestand als Eröffnungsbuchung.
 *
 * Nicht in article.stock schreiben: der Bestand entsteht seit dem
 * Materialmodul aus Bewegungen. Eine Zahl, die daneben in einer Spalte
 * steht, weicht früher oder später ab — und dann glaubt man der
 * falschen.
 */
export async function lagerbestand(c: Ctx): Promise<void> {
  const lager = c.leute.find((l) => l.role === "lager")!;

  const { data: artikel } = await c.db
    .from("article")
    .select("id, sku, purchase_price, min_stock")
    .eq("company_id", c.company)
    .eq("active", true)
    .in("sku", [
      "MOD-JAS-440",
      "WR-FRO-10",
      "SH-10281",
      "SH-10289",
      "UK-K2-SD",
      "SH-10262",
      "SH-10258",
    ]);

  /*
   * Bewusst ungleich: von den Modulen liegt reichlich da, beim
   * Wechselrichter reicht es knapp, die Kurzschiene ist unter dem
   * Mindestbestand. Nur so zeigt die Deckungsrechnung etwas.
   */
  const bestand: Record<string, number> = {
    "MOD-JAS-440": 96,
    "WR-FRO-10": 3,
    "SH-10281": 420,
    "SH-10289": 60,
    "UK-K2-SD": 24,
    "SH-10262": 150,
    "SH-10258": 4,
  };

  const min: Record<string, number> = {
    "MOD-JAS-440": 20,
    "WR-FRO-10": 2,
    "SH-10281": 100,
    "SH-10289": 30,
    "UK-K2-SD": 10,
    "SH-10262": 40,
    "SH-10258": 20,
  };

  const zeilen: Record<string, unknown>[] = [];
  for (const a of (artikel ?? []) as { id: string; sku: string; purchase_price: number }[]) {
    const menge = bestand[a.sku];
    if (!menge) continue;
    zeilen.push({
      company_id: c.company,
      artikel_id: a.id,
      typ: "wareneingang",
      nach_lagerort_id: c.hauptlager,
      menge,
      ek_zum_zeitpunkt: a.purchase_price,
      notiz: "Anfangsbestand",
      created_by: lager.id,
      created_at: c.uhr(c.tag(-90), "08:00"),
    });
    await c.db
      .from("article")
      .update({ min_stock: min[a.sku] ?? 0 })
      .eq("id", a.id);
  }

  const { error } = await c.db.from("lagerbewegung").insert(zeilen);
  if (error) throw error;

  console.log(`  Anfangsbestand für ${zeilen.length} Artikel, einer unter Mindestbestand`);
}

/* --------------------------------------------------------------- BEDARF */

/**
 * Bedarfslisten mit allen vier Deckungsstufen.
 *
 * Das ist der Screen, an dem sich das Materialmodul zeigt: gedeckt,
 * bestellt mit Termin, bestellt ohne Termin, gar nichts. Wäre alles
 * grün, könnte man die Liste auch weglassen.
 */
export async function bedarf(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const laufend = liste.filter((v) => v.phase === "beauftragt" || v.phase === "montage");

  const { data: pos } = await c.db
    .from("vorgang_position")
    .select("vorgang_id, article_id, bezeichnung, menge, einheit, sort")
    .in("vorgang_id", laufend.map((v) => v.id))
    .eq("ist_material", true)
    .order("sort");

  const zeilen = ((pos ?? []) as {
    vorgang_id: string;
    article_id: string | null;
    bezeichnung: string;
    menge: number;
    einheit: string;
    sort: number;
  }[])
    .filter((p) => p.article_id)
    .map((p) => ({
      company_id: c.company,
      vorgang_id: p.vorgang_id,
      artikel_id: p.article_id,
      bezeichnung: p.bezeichnung,
      menge: p.menge,
      einheit: p.einheit,
      sort: p.sort,
      herkunft: "angebot",
    }));

  for (let i = 0; i < zeilen.length; i += 200) {
    const { error } = await c.db.from("vorgang_bedarf").insert(zeilen.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(`  ${zeilen.length} Bedarfspositionen auf ${laufend.length} laufenden Vorgängen`);
}

/* ---------------------------------------------------------- BESTELLUNGEN */

export async function bestellungen(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const lager = c.leute.find((l) => l.role === "lager")!;

  const { data: lieferant } = await c.db
    .from("lieferant")
    .select("id, name")
    .eq("company_id", c.company)
    .limit(1)
    .maybeSingle();

  const lieferantId = (lieferant?.id as string | undefined) ?? null;

  const laufend = liste.filter((v) => v.phase === "beauftragt" || v.phase === "montage");
  const { data: bedarfe } = await c.db
    .from("vorgang_bedarf")
    .select("id, vorgang_id, artikel_id, bezeichnung, menge, einheit")
    .in("vorgang_id", laufend.map((v) => v.id))
    .order("sort");

  const alle = (bedarfe ?? []) as {
    id: string;
    vorgang_id: string;
    artikel_id: string;
    bezeichnung: string;
    menge: number;
    einheit: string;
  }[];

  /*
   * Drei Bestellungen mit drei Zuständen: eine unterwegs mit bestätigtem
   * Termin, eine halb geliefert, eine noch als Entwurf. Ein Betrieb hat
   * nie nur einen davon.
   */
  const unterwegs = alle.slice(0, 3);
  const halb = alle.slice(3, 5);
  const entwurf = alle.slice(5, 7);

  async function anlegen(
    nummer: string | null,
    status: string,
    zeilen: typeof alle,
    termin: string | null,
    geliefert: (m: number) => number,
  ): Promise<void> {
    if (zeilen.length === 0) return;
    const { data: b, error } = await c.db
      .from("bestellung")
      .insert({
        company_id: c.company,
        nummer,
        lieferant_id: lieferantId,
        status,
        ziel: "hauptlager",
        ziel_lagerort_id: c.hauptlager,
        wunschtermin: termin,
        bestellt_am: status === "entwurf" ? null : c.uhr(c.tag(-6), "10:00"),
        created_by: lager.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { error: pe } = await c.db.from("bestellposition").insert(
      zeilen.map((z, i) => ({
        company_id: c.company,
        bestellung_id: b!.id,
        artikel_id: z.artikel_id,
        bezeichnung: z.bezeichnung,
        menge: z.menge,
        gelieferte_menge: geliefert(Number(z.menge)),
        einheit: z.einheit,
        vorgang_id: z.vorgang_id,
        bedarf_id: z.id,
        bestaetigter_termin: termin,
        sort: i * 10,
      })),
    );
    if (pe) throw pe;
  }

  await anlegen("B-2026-0041", "bestellt", unterwegs, c.tag(4), () => 0);
  /* Überfällig: der zugesagte Tag ist vorbei und nichts kam an. */
  await anlegen("B-2026-0042", "teilgeliefert", halb, c.tag(-2), (m) => Math.floor(m / 2));
  await anlegen(null, "entwurf", entwurf, null, () => 0);

  console.log("  3 Bestellungen: unterwegs, halb geliefert, Entwurf (eine überfällig)");
}

/* -------------------------------------------------------------- PLANUNG */

export async function planung(c: Ctx, liste: VorgangDemo[]): Promise<string[]> {
  const bauleitung = c.leute.find((l) => l.role === "bauleitung")!;
  const mo = c.montag();

  /*
   * Wer abwesend ist, wird nicht eingeteilt. Der Seed schreibt direkt in
   * die Datenbank und umgeht damit die Konfliktprüfung — stünde ein
   * Monteur im Krankenstand auf einer Baustelle, zeigte die Demo einen
   * Zustand, den die Software selbst nie zugelassen hätte.
   */
  const { data: frei } = await c.db
    .from("absence")
    .select("user_id, from_date, to_date")
    .eq("status", "approved");

  const abwesend = (frei ?? []) as { user_id: string; from_date: string; to_date: string }[];
  const kann = (userId: string, t: string): boolean =>
    !abwesend.some((a) => a.user_id === userId && a.from_date <= t && a.to_date >= t);

  const alleMonteure = c.leute.filter((l) => l.role === "monteur");

  const montage = liste.filter((v) => v.phase === "montage");
  const beauftragt = liste.filter((v) => v.phase === "beauftragt");

  const einsaetze: Record<string, unknown>[] = [];
  const besetzung: { einsatz: number; user: string }[] = [];

  /* Zwei Baustellen über je drei Tage — so plant ein PV-Betrieb. */
  montage.forEach((v, vi) => {
    for (let d = 0; d < 3; d++) {
      const t = c.plus(mo, vi === 0 ? d : d + 1);
      if (!c.istWerktag(t)) continue;
      const i = einsaetze.length;
      einsaetze.push({
        company_id: c.company,
        art: "auftrag",
        vorgang_id: v.id,
        titel: `Montage Tag ${d + 1}`,
        von: c.uhr(t, d === 0 ? "07:00" : "07:30"),
        bis: c.uhr(t, "16:00"),
        fahrzeug_id: c.fahrzeuge[vi % c.fahrzeuge.length]?.id ?? null,
        notiz:
          d === 0
            ? vi === 0
              ? "Schlüssel beim Nachbarn, Zufahrt über den Hof."
              : "Hubsteiger ist bestellt, steht ab 7 Uhr da."
            : null,
      });
      /*
       * Zwei Monteure je Baustelle — allein hebt niemand ein Modul aufs
       * Dach. Und feste Teams: Baustelle 0 bekommt die ersten beiden,
       * Baustelle 1 die nächsten. Vorher rotierte die Auswahl über alle
       * Monteure, und derselbe Mann stand an einem Tag auf zwei
       * ganztägigen Montagen — ein Zustand, den die Konfliktprüfung
       * blockiert hätte und der in der Wochenansicht als sechzehn
       * Stunden auftauchte.
       */
      const team = alleMonteure
        .slice(vi * 2, vi * 2 + 2)
        .filter((m) => kann(m.id, t));
      if (team.length === 0) continue;
      for (const m of team) besetzung.push({ einsatz: i, user: m.id });
    }
  });

  /* Eine Aufnahme vor Ort — die Bauleitung fährt allein. */
  if (beauftragt[0]) {
    const t = c.plus(mo, 3);
    const i = einsaetze.length;
    einsaetze.push({
      company_id: c.company,
      art: "auftrag",
      vorgang_id: beauftragt[0].id,
      titel: "Aufmaß und Zählerkasten prüfen",
      von: c.uhr(t, "09:00"),
      bis: c.uhr(t, "12:00"),
      notiz: null,
    });
    besetzung.push({ einsatz: i, user: bauleitung.id });
  }

  /*
   * Ein Serviceeinsatz OHNE Vorgang, dafür mit Kunde. Genau der Fall,
   * für den es die Kundenzuordnung am Einsatz gibt: die Anlage steht
   * seit Jahren, es gibt keinen laufenden Auftrag, jemand fährt hin.
   */
  /*
   * Donnerstag, nicht Mittwoch: Mittwoch stehen beide Montageteams auf
   * dem Dach, und der Serviceeinsatz landete beim Rückfall auf einem
   * Monteur, der schon eine ganztägige Baustelle hatte. Zwei Orte
   * gleichzeitig ist genau der Konflikt, den die Plantafel verhindern
   * soll — er gehört nicht in die Demo.
   */
  const service = c.plus(mo, 3);
  const iService = einsaetze.length;
  einsaetze.push({
    company_id: c.company,
    art: "service",
    vorgang_id: null,
    kunde_id: c.kunden[1]!.id,
    titel: "Störung: Wechselrichter meldet Fehler 301",
    von: c.uhr(service, "13:00"),
    bis: c.uhr(service, "16:00"),
    notiz: "Kunde ist ab 13 Uhr vor Ort, Zugang über die Werkstatt.",
  });
  /*
   * Der Servicemann ist keiner der beiden Montageteams — sonst steht er
   * am Nachmittag an zwei Orten.
   */
  const serviceTeam = alleMonteure.filter(
    (m) =>
      kann(m.id, service) &&
      !besetzung.some(
        (b) => b.user === m.id && (einsaetze[b.einsatz] as { von: string }).von.slice(0, 10) === service,
      ),
  );
  /*
   * Kein Rückfall auf irgendjemanden: ist wirklich niemand frei, fährt
   * niemand — und der Einsatz bleibt unbesetzt sichtbar. Eine erfundene
   * Besetzung wäre schlimmer als eine offene.
   */
  if (serviceTeam[0]) besetzung.push({ einsatz: iService, user: serviceTeam[0].id });

  /* Und ein interner Tag: Lager zählen. Auch das ist Kapazität. */
  const intern = c.plus(mo, 4);
  const iIntern = einsaetze.length;
  einsaetze.push({
    company_id: c.company,
    art: "intern",
    vorgang_id: null,
    titel: "Inventur Bus 1 und Bus 2",
    von: c.uhr(intern, "13:00"),
    bis: c.uhr(intern, "16:30"),
    notiz: null,
  });
  besetzung.push({ einsatz: iIntern, user: c.leute.find((l) => l.role === "lager")!.id });

  /* Nächste Woche steht schon etwas — sonst wirkt der Betrieb leer. */
  const naechste = c.plus(mo, 7);
  beauftragt.forEach((v, vi) => {
    const t = c.plus(naechste, vi);
    if (!c.istWerktag(t)) return;
    const i = einsaetze.length;
    einsaetze.push({
      company_id: c.company,
      art: "auftrag",
      vorgang_id: v.id,
      titel: "Montage Tag 1",
      von: c.uhr(t, "07:00"),
      bis: c.uhr(t, "16:00"),
      fahrzeug_id: c.fahrzeuge[vi % c.fahrzeuge.length]?.id ?? null,
      notiz: null,
    });
    const team2 = alleMonteure.slice(vi * 2, vi * 2 + 2).filter((m) => kann(m.id, t));
    if (team2.length === 0) return;
    for (const m of team2) besetzung.push({ einsatz: i, user: m.id });
  });

  const { data, error } = await c.db.from("einsatz").insert(einsaetze).select("id");
  if (error) throw error;
  const ids = (data as { id: string }[]).map((e) => e.id);

  const { error: pe } = await c.db.from("einsatz_person").insert(
    besetzung.map((b) => ({
      company_id: c.company,
      einsatz_id: ids[b.einsatz]!,
      user_id: b.user,
    })),
  );
  if (pe) throw pe;

  console.log(`  ${ids.length} Einsätze diese und nächste Woche, davon ein Service ohne Vorgang`);
  return ids;
}

/* ---------------------------------------------------------------- ZEITEN */

/**
 * Zeitbuchungen der letzten acht Wochen.
 *
 * Jede hängt an einem Einsatz — ohne ihn gehört sie niemandem. Für die
 * Vergangenheit entsteht deshalb je Person und Tag ein Einsatz, so wie
 * ihn die Plantafel angelegt hätte.
 */
export async function zeiten(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const arbeitende = c.leute.filter((l) => l.role !== "gf");
  const ziele = liste.filter((v) => v.phase === "montage" || v.phase === "abschluss");
  if (ziele.length === 0) return;

  /*
   * Nur bis zum letzten Sonntag. Die laufende Woche ist geplant — dort
   * hängen die Zeiten an den Einsätzen der Plantafel. Legte dieses
   * Skript auch dort eigene an, stünde jeder Monteur zweimal am selben
   * Tag auf zwei Baustellen, und die Konfliktprüfung hätte recht.
   */
  const bisTag = c.plus(c.montag(), -1);

  /*
   * Wer krank oder auf Urlaub war, hat nicht gearbeitet. Ohne diese
   * Prüfung stünde eine Zeitbuchung neben einem Krankenstand — und die
   * Plausibilitätsprüfung, die genau so etwas finden soll, wäre in der
   * Demo selbst der Fall, den sie meldet.
   */
  const { data: frei } = await c.db
    .from("absence")
    .select("user_id, from_date, to_date")
    .eq("status", "approved");

  const abwesend = (frei ?? []) as { user_id: string; from_date: string; to_date: string }[];
  const istFrei = (userId: string, t: string): boolean =>
    abwesend.some((a) => a.user_id === userId && a.from_date <= t && a.to_date >= t);

  const einsaetze: Record<string, unknown>[] = [];
  const besetzung: { einsatz: number; user: string }[] = [];
  const buchungen: { einsatz: number; user: string; von: string; bis: string; status: string; pause: number }[] = [];

  /*
   * Ein volles Jahr, nicht acht Wochen.
   *
   * Der Saldo rechnet Ist gegen Soll über zwölf Monate. Reichen die
   * Buchungen nur zwei Monate zurück, steht bei jedem Mitarbeiter ein
   * Minus von über tausend Stunden — und der Saldoverlauf ist eine Wand
   * aus roten Balken. Das sagt nichts über die Software und alles über
   * den Seed.
   */
  for (let n = 1; n <= 400; n++) {
    const t = c.tag(-n);
    if (!c.istWerktag(t)) continue;
    if (t > bisTag) continue;

    arbeitende.forEach((u, i) => {
      if (istFrei(u.id, t)) return;

      const v = ziele[(n + i) % ziele.length]!;
      const beginn = 7 + ((n + i) % 3) * 0.5;
      /*
       * Die Tagesleistung liegt um das Wochensoll herum, mit Streuung
       * nach oben und unten. So landet der Saldo nahe null und schwankt
       * über die Monate — ein Konto, das exakt null ist, hat niemand.
       */
      const soll = u.weekly / 5;
      const stunden = Math.round((soll + (((n * 3 + i) % 5) - 2) * 0.25) * 4) / 4;

      const vonHhmm = `${String(Math.floor(beginn)).padStart(2, "0")}:${beginn % 1 ? "30" : "00"}`;
      const von = c.uhr(t, vonHhmm);
      const bis = new Date(new Date(von).getTime() + stunden * 3600_000).toISOString();

      const idx = einsaetze.length;
      einsaetze.push({
        company_id: c.company,
        art: "auftrag",
        vorgang_id: v.id,
        titel: "Montage",
        von,
        bis,
      });
      besetzung.push({ einsatz: idx, user: u.id });
      buchungen.push({
        einsatz: idx,
        user: u.id,
        von,
        bis,
        /* Die letzten Tage sind noch nicht genehmigt — dafür gibt es den Wochenabschluss. */
        status: n <= 4 ? "booked" : "approved",
        pause: stunden >= 6 ? 30 : 0,
      });
    });
  }

  const ids: string[] = [];
  for (let i = 0; i < einsaetze.length; i += 200) {
    const { data, error } = await c.db
      .from("einsatz")
      .insert(einsaetze.slice(i, i + 200))
      .select("id");
    if (error) throw error;
    ids.push(...(data as { id: string }[]).map((e) => e.id));
  }

  const personen = besetzung.map((b) => ({
    company_id: c.company,
    einsatz_id: ids[b.einsatz]!,
    user_id: b.user,
  }));
  for (let i = 0; i < personen.length; i += 200) {
    const { error } = await c.db.from("einsatz_person").insert(personen.slice(i, i + 200));
    if (error) throw error;
  }

  const { data: vorgangJe } = await c.db
    .from("einsatz")
    .select("id, vorgang_id")
    .in("id", ids);
  const vorgangVon = new Map(
    ((vorgangJe ?? []) as { id: string; vorgang_id: string | null }[]).map((e) => [e.id, e.vorgang_id]),
  );

  const zeilen = buchungen.map((b) => ({
    company_id: c.company,
    user_id: b.user,
    einsatz_id: ids[b.einsatz]!,
    vorgang_id: vorgangVon.get(ids[b.einsatz]!) ?? null,
    kind: "work",
    started_at: b.von,
    ended_at: b.bis,
    status: b.status,
    quelle: "monteur_app",
    /*
     * Jeder Schlüssel steht in JEDER Zeile: PostgREST setzt bei einem
     * Mehrzeilen-Insert alles, was nicht überall vorkommt, auf null —
     * die Spaltenvorgabe greift dann nicht.
     */
    auto_break_min: b.pause,
  }));

  for (let i = 0; i < zeilen.length; i += 200) {
    const { error } = await c.db.from("time_entry").insert(zeilen.slice(i, i + 200));
    if (error) throw error;
  }

  await zeitenAufPlanung(c, istFrei);

  console.log(`  ${zeilen.length} Zeitbuchungen über acht Wochen, an ${ids.length} Einsätzen`);
}

/**
 * Die Tage dieser Woche, die schon vorbei sind.
 *
 * Hier wird nichts erfunden: die Einsätze stehen in der Plantafel, und
 * die Zeit hängt an genau dem Einsatz, für den sie geplant war. Das ist
 * der Normalfall im Betrieb — geplant, gefahren, gestempelt — und der
 * einzige, bei dem die Ist-Stunden am Vorgang etwas bedeuten.
 */
async function zeitenAufPlanung(
  c: Ctx,
  istFrei: (userId: string, t: string) => boolean,
): Promise<void> {
  const heute = c.tag(0);

  const { data: geplant } = await c.db
    .from("einsatz")
    .select("id, vorgang_id, von, bis, art, personen:einsatz_person ( user_id )")
    .gte("von", c.uhr(c.montag(), "00:00"))
    .lt("von", c.uhr(heute, "00:00"));

  const zeilen: Record<string, unknown>[] = [];
  for (const e of (geplant ?? []) as {
    id: string;
    vorgang_id: string | null;
    von: string;
    bis: string;
    art: string;
    personen: { user_id: string }[] | null;
  }[]) {
    const t = e.von.slice(0, 10);
    for (const p of e.personen ?? []) {
      if (istFrei(p.user_id, t)) continue;
      const dauer = (new Date(e.bis).getTime() - new Date(e.von).getTime()) / 60_000;
      zeilen.push({
        company_id: c.company,
        user_id: p.user_id,
        einsatz_id: e.id,
        vorgang_id: e.vorgang_id,
        kind: "work",
        started_at: e.von,
        ended_at: e.bis,
        /* Diese Woche ist noch nicht abgeschlossen. */
        status: "booked",
        quelle: "monteur_app",
        auto_break_min: dauer >= 360 ? 30 : 0,
      });
    }
  }

  /*
   * Wer diese Woche nicht auf einer geplanten Baustelle stand, hat
   * trotzdem gearbeitet — Büro, Lager, Werkstatt. Ohne diese Buchungen
   * zeigte die Kachel "Stunden diese Woche" ein Drittel des Erwarteten
   * und sah aus, als hätte der halbe Betrieb freigenommen.
   */
  const gebucht = new Set(zeilen.map((z) => `${z.user_id as string}|${(z.started_at as string).slice(0, 10)}`));
  const intern: Record<string, unknown>[] = [];

  for (let n = 1; n <= 6; n++) {
    const t = c.tag(-n);
    if (t < c.montag() || !c.istWerktag(t)) continue;

    for (const u of c.leute.filter((l) => l.role !== "gf")) {
      if (gebucht.has(`${u.id}|${t}`) || istFrei(u.id, t)) continue;
      const stunden = Math.round((u.weekly / 5) * 4) / 4;
      const von = c.uhr(t, "07:30");
      const bis = new Date(new Date(von).getTime() + stunden * 3600_000).toISOString();
      intern.push({
        einsatz: null,
        von,
        bis,
        userId: u.id,
        stunden,
        tag: t,
      });
    }
  }

  /* Für jede dieser Buchungen ein interner Einsatz — Zeit ohne Einsatz gibt es nicht. */
  if (intern.length > 0) {
    const { data: neue, error: ee } = await c.db
      .from("einsatz")
      .insert(
        intern.map((i) => ({
          company_id: c.company,
          art: "intern",
          titel: "Werkstatt und Vorbereitung",
          von: i.von,
          bis: i.bis,
        })),
      )
      .select("id");
    if (ee) throw ee;

    const ids2 = (neue as { id: string }[]).map((e) => e.id);
    await c.db.from("einsatz_person").insert(
      intern.map((i, k) => ({
        company_id: c.company,
        einsatz_id: ids2[k]!,
        user_id: i.userId,
      })),
    );

    intern.forEach((i, k) => {
      zeilen.push({
        company_id: c.company,
        user_id: i.userId,
        einsatz_id: ids2[k]!,
        vorgang_id: null,
        kind: "work",
        started_at: i.von,
        ended_at: i.bis,
        status: "booked",
        quelle: "manuell",
        auto_break_min: Number(i.stunden) >= 6 ? 30 : 0,
      });
    });
  }

  if (zeilen.length === 0) return;
  const { error } = await c.db.from("time_entry").insert(zeilen);
  if (error) throw error;
  console.log(`  ${zeilen.length} Buchungen dieser Woche, davon ${intern.length} intern`);
}

/* -------------------------------------------------- ABWESENHEIT & SERVICE */

export async function abwesenheiten(c: Ctx): Promise<void> {
  const monteure = c.leute.filter((l) => l.role === "monteur");
  const buero = c.leute.find((l) => l.role === "buero")!;
  const gf = c.leute.find((l) => l.role === "gf")!;
  const mo = c.montag();

  const zeilen = [
    {
      company_id: c.company,
      user_id: monteure[monteure.length - 1]!.id,
      kind: "vacation",
      from_date: c.plus(mo, 7),
      to_date: c.plus(mo, 11),
      half_day: false,
      status: "approved",
      decided_at: c.uhr(c.tag(-12), "10:00"),
      approver_id: gf.id,
      note: "Sommerurlaub, lange geplant.",
    },
    {
      company_id: c.company,
      /*
       * Krankenstand ohne Grund und ohne Freitext — Art. 9 DSGVO. Es
       * gibt im Datenmodell bewusst kein Feld dafür.
       */
      user_id: monteure[1]?.id ?? monteure[0]!.id,
      kind: "sick",
      from_date: c.tag(-2),
      to_date: c.tag(-1),
      half_day: false,
      status: "approved",
      decided_at: c.uhr(c.tag(-2), "07:30"),
      approver_id: gf.id,
      note: null,
    },
    {
      company_id: c.company,
      user_id: buero.id,
      kind: "vacation",
      from_date: c.plus(mo, 14),
      to_date: c.plus(mo, 16),
      half_day: false,
      /* Einer wartet auf Entscheidung — sonst sieht man den Ablauf nicht. */
      status: "requested",
      decided_at: null,
      approver_id: null,
      note: "Verlängertes Wochenende.",
    },
  ];

  const { error } = await c.db.from("absence").insert(zeilen);
  if (error) throw error;
  console.log("  3 Abwesenheiten, eine davon offen zur Entscheidung");
}

export async function anliegen(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const buero = c.leute.find((l) => l.role === "buero")!;
  const fertig = liste.find((v) => v.phase === "abschluss");

  const zeilen = [
    {
      company_id: c.company,
      customer_id: c.kunden[1]!.id,
      number: "S-2026-0101",
      source: "portal",
      category: "stoerung",
      severity: 1,
      status: "offen",
      body: "Wechselrichter meldet seit heute früh Fehler 301, Anlage steht.",
      created_at: c.uhr(c.tag(-1), "07:20"),
    },
    {
      company_id: c.company,
      customer_id: c.kunden[0]!.id,
      number: "S-2026-0102",
      source: "phone",
      category: "frage",
      severity: 3,
      status: "offen",
      body: "Bitte um Einweisung in die App für den Speicher.",
      created_at: c.uhr(c.tag(-4), "14:05"),
    },
    {
      company_id: c.company,
      customer_id: fertig?.kunde.id ?? c.kunden[3]!.id,
      number: "S-2026-0100",
      source: "portal",
      category: "frage",
      severity: 3,
      status: "behoben",
      assignee_id: buero.id,
      body: "Wo finde ich die Unterlagen für die Förderung?",
      response:
        "Die Bestätigung liegt in Ihrem Portal unter Dokumente. Wir haben sie zusätzlich per Mail geschickt.",
      responded_at: c.uhr(c.tag(-9), "09:40"),
      created_at: c.uhr(c.tag(-10), "18:30"),
    },
  ];

  const { error } = await c.db.from("service_ticket").insert(zeilen);
  if (error) throw error;
  console.log("  3 Serviceanliegen: eine Störung, eine Frage, eine erledigt");
}

/* ------------------------------------------------------------- NACHTRAG */

/**
 * Was das Cockpit liest, aber kein Trigger schreibt.
 *
 * Auftragswert, Sollstunden und Sollmaterial stehen als Spalten am
 * Vorgang und werden im Anwendungscode gerechnet, wenn sich eine
 * Position ändert. Ein Seed, der Positionen direkt einfügt, umgeht das —
 * und dann steht im Cockpit ein Auftragsbestand von null neben zehn
 * Vorgängen. Die Rechnung ist dieselbe: Menge mal Einzelpreis.
 */
export async function werteNachziehen(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const { data: pos } = await c.db
    .from("vorgang_position")
    .select("vorgang_id, menge, ep_netto, kalk_stunden, kalk_ek, ist_material")
    .in("vorgang_id", liste.map((v) => v.id))
    .is("dokument_id", null);

  const je = new Map<string, { netto: number; stunden: number; material: number }>();
  for (const p of (pos ?? []) as {
    vorgang_id: string;
    menge: number;
    ep_netto: number;
    kalk_stunden: number | null;
    kalk_ek: number | null;
    ist_material: boolean;
  }[]) {
    const s = je.get(p.vorgang_id) ?? { netto: 0, stunden: 0, material: 0 };
    const menge = Number(p.menge);
    s.netto += menge * Number(p.ep_netto);
    s.stunden += menge * Number(p.kalk_stunden ?? 0);
    if (p.ist_material) s.material += menge * Number(p.kalk_ek ?? 0);
    je.set(p.vorgang_id, s);
  }

  /* Beauftragt heisst: der Wert ist keine Hoffnung mehr, sondern Umsatz. */
  const beauftragt = new Set(["beauftragt", "montage", "abschluss"]);

  for (const v of liste) {
    const s = je.get(v.id);
    if (!s) continue;
    await c.db
      .from("vorgang")
      .update({
        angebotswert_netto: Math.round(s.netto * 100) / 100,
        auftragswert_netto: beauftragt.has(v.phase)
          ? Math.round(s.netto * 100) / 100
          : null,
        soll_stunden: Math.round(s.stunden * 100) / 100,
        soll_materialkosten: Math.round(s.material * 100) / 100,
      })
      .eq("id", v.id);
  }

  console.log(`  Auftragswerte und Sollzahlen für ${je.size} Vorgänge gerechnet`);
}

/**
 * Montagetermine am Vorgang.
 *
 * Der Einsatz ist die Planungseinheit, aber Cockpit und Auslastung lesen
 * den Zeitraum aus vorgang_termin — dort steht "wann wird gebaut", nicht
 * "wer fährt wann". Ohne diese Zeile steht im Cockpit "kein Auftrag
 * terminiert", obwohl die Plantafel voll ist.
 */
export async function termine(c: Ctx, liste: VorgangDemo[], _ids: string[]): Promise<void> {
  const { data: einsaetze } = await c.db
    .from("einsatz")
    .select("vorgang_id, von, bis")
    .eq("art", "auftrag")
    .not("vorgang_id", "is", null)
    .gte("von", c.uhr(c.montag(), "00:00"))
    .order("von");

  const spanne = new Map<string, { von: string; bis: string }>();
  for (const e of (einsaetze ?? []) as { vorgang_id: string; von: string; bis: string }[]) {
    const da = spanne.get(e.vorgang_id);
    if (!da) spanne.set(e.vorgang_id, { von: e.von, bis: e.bis });
    else if (e.bis > da.bis) da.bis = e.bis;
  }

  const zeilen = [...spanne.entries()].map(([vorgangId, s]) => ({
    company_id: c.company,
    vorgang_id: vorgangId,
    art: "montage",
    von: s.von,
    bis: s.bis,
  }));

  if (zeilen.length === 0) return;
  const { error } = await c.db.from("vorgang_termin").insert(zeilen);
  if (error) throw error;

  console.log(`  ${zeilen.length} Montagetermine am Vorgang`);
}

/**
 * Rechnungen — Anzahlung, Schlussrechnung, eine davon überfällig.
 *
 * Ohne sie ist der Durchlauf nach der Montage zu Ende, und die
 * Offene-Posten-Liste bleibt leer. Genau dort schaut ein Betrieb aber
 * als Erstes hin.
 */
export async function rechnungen(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const buero = c.leute.find((l) => l.role === "buero")!;
  const { data: werte } = await c.db
    .from("vorgang")
    .select("id, auftragswert_netto, anzahlung_prozent, phase, number")
    .in("id", liste.map((v) => v.id))
    .not("auftragswert_netto", "is", null);

  const zeilen: Record<string, unknown>[] = [];
  let nr = 1;
  let nummerA = "";
  let nummerS = "";

  for (const v of (werte ?? []) as {
    id: string;
    auftragswert_netto: number;
    anzahlung_prozent: number;
    phase: string;
  }[]) {
    const netto = Number(v.auftragswert_netto);
    const anzahlung = Math.round(netto * (Number(v.anzahlung_prozent) / 100) * 100) / 100;

    zeilen.push({
      company_id: c.company,
      vorgang_id: v.id,
      typ: "anzahlungsrechnung",
      nummer: (nummerA = `R-2026-${String(3000 + nr++)}`),
      /*
       * Ohne PDF im Storage: der Dateiname beschreibt, was dort läge.
       * Ein Beleg ohne Namen liesse sich in der Liste nicht ansprechen,
       * und die Spalte ist nicht umsonst NOT NULL.
       */
      dateiname: `${nummerA}.pdf`,
      storage_path: null,
      betrag_netto: anzahlung,
      betrag_brutto: Math.round(anzahlung * 1.2 * 100) / 100,
      /*
       * Eine ist offen und über dem Zahlungsziel — der Mahnlauf braucht
       * etwas zu tun, sonst zeigt die Demo eine Funktion ohne Fall.
       */
      status: v.phase === "abschluss" ? "bezahlt" : "versendet",
      faellig_am: v.phase === "montage" ? c.tag(-9) : c.tag(12),
      bezahlt_am: v.phase === "abschluss" ? c.tag(-55) : null,
      kunde_sichtbar: true,
      created_by: buero.id,
      created_at: c.uhr(c.tag(v.phase === "abschluss" ? -70 : -20), "10:00"),
    });

    if (v.phase === "abschluss") {
      const rest = Math.round((netto - anzahlung) * 100) / 100;
      zeilen.push({
        company_id: c.company,
        vorgang_id: v.id,
        typ: "schlussrechnung",
        nummer: (nummerS = `R-2026-${String(3000 + nr++)}`),
        dateiname: `${nummerS}.pdf`,
        storage_path: null,
        betrag_netto: rest,
        betrag_brutto: Math.round(rest * 1.2 * 100) / 100,
        status: "versendet",
        faellig_am: c.tag(-3),
        kunde_sichtbar: true,
        created_by: buero.id,
        created_at: c.uhr(c.tag(-17), "10:00"),
      });
    }
  }

  const { error } = await c.db.from("vorgang_dokument").insert(zeilen);
  if (error) throw error;

  console.log(`  ${zeilen.length} Rechnungen, davon zwei über dem Zahlungsziel`);
}

/**
 * Mindestbestände aufräumen.
 *
 * Der Artikelstamm kommt aus dem Handelsgeschäft und trägt teils
 * Mindestbestände, für die dieser Betrieb nie etwas eingelagert hat.
 * Jeder davon meldet sich als "unter Mindestbestand" — und eine Warnung,
 * die für vierhundert Artikel gleichzeitig gilt, liest niemand.
 */
export async function mindestbestaende(c: Ctx, gepflegt: string[]): Promise<void> {
  const { error } = await c.db
    .from("article")
    .update({ min_stock: 0 })
    .eq("company_id", c.company)
    .not("sku", "in", `(${gepflegt.join(",")})`);
  if (error) throw error;
  console.log(`  Mindestbestand nur noch auf ${gepflegt.length} gepflegten Artikeln`);
}

/**
 * Der Verlauf am Vorgang — „was bisher passiert ist".
 *
 * Ohne ihn steht auf jeder Vorgangsseite und im Kundenportal eine leere
 * Fläche mit Überschrift. Der Verlauf ist aber genau das, was einen
 * Vorgang von einer Zeile in einer Tabelle unterscheidet: man sieht,
 * wer wann was entschieden hat.
 *
 * Die Einträge folgen der Phase: ein Vorgang in Montage hat Aufnahme,
 * Angebot und Annahme hinter sich, eine Anfrage nur ihren Eingang.
 */
export async function verlauf(c: Ctx, liste: VorgangDemo[]): Promise<void> {
  const gf = c.leute.find((l) => l.role === "gf")!;
  const buero = c.leute.find((l) => l.role === "buero")!;
  const bauleitung = c.leute.find((l) => l.role === "bauleitung")!;

  /* Die Stationen in der Reihenfolge, in der ein Vorgang sie durchläuft. */
  const STATIONEN: { phase: string; typ: string; titel: string; body: string | null; wer: string }[] = [
    {
      phase: "anfrage",
      typ: "notiz",
      titel: "Anfrage eingegangen",
      body: "Über das Kontaktformular. Rückruf vereinbart.",
      wer: buero.id,
    },
    {
      phase: "aufnahme",
      typ: "phase_wechsel",
      titel: "Aufnahme gestartet",
      body: "Termin vor Ort für das Aufmaß steht.",
      wer: bauleitung.id,
    },
    {
      phase: "angebot",
      typ: "phase_wechsel",
      titel: "Angebot erstellt",
      body: null,
      wer: gf.id,
    },
    {
      phase: "beauftragt",
      typ: "phase_wechsel",
      titel: "Angebot angenommen",
      body: "Kunde hat unterschrieben. Anzahlungsrechnung geht raus.",
      wer: gf.id,
    },
    {
      phase: "montage",
      typ: "termin",
      titel: "Montage terminiert",
      body: null,
      wer: bauleitung.id,
    },
    {
      phase: "abschluss",
      typ: "gate_update",
      titel: "Inbetriebnahme protokolliert",
      body: "Zählertausch erledigt, Anlage läuft.",
      wer: bauleitung.id,
    },
  ];

  const REIHE = ["anfrage", "aufnahme", "angebot", "beauftragt", "montage", "abschluss"];

  const zeilen: Record<string, unknown>[] = [];
  for (const v of liste) {
    /*
     * Ein verlorener Vorgang ist bis zum Angebot gekommen — sonst gäbe
     * es nichts zu verlieren.
     */
    const bis = v.phase === "verloren" ? REIHE.indexOf("angebot") : REIHE.indexOf(v.phase);
    if (bis < 0) continue;

    STATIONEN.slice(0, bis + 1).forEach((st, i) => {
      zeilen.push({
        company_id: c.company,
        vorgang_id: v.id,
        typ: st.typ,
        titel: st.titel,
        body: st.body,
        created_by: st.wer,
        /* Rückwärts gestaffelt, damit die Reihenfolge stimmt. */
        /*
         * Zweistellig: "9:15" ist keine gültige Uhrzeit für den Parser,
         * "09:15" schon. Der Fehler fällt erst beim letzten Vorgang auf.
         */
        created_at: c.uhr(
          c.tag(-40 + i * 6),
          `${String(9 + (i % 6)).padStart(2, "0")}:15`,
        ),
      });
    });

    if (v.phase === "verloren") {
      zeilen.push({
        company_id: c.company,
        vorgang_id: v.id,
        typ: "notiz",
        titel: "Vorgang verloren",
        body: "Mitbewerber lag 8 % darunter. Kunde hat dort unterschrieben.",
        created_by: gf.id,
        created_at: c.uhr(c.tag(-40), "11:00"),
      });
    }
  }

  for (let i = 0; i < zeilen.length; i += 200) {
    const { error } = await c.db.from("vorgang_event").insert(zeilen.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(`  ${zeilen.length} Verlaufseinträge an den Vorgängen`);
}

/**
 * Nachweise am Mitarbeiter — mit einem, der demnächst abläuft.
 *
 * Ohne sie steht auf der Mitarbeiterseite dreimal null und in jeder
 * Zeile ein Strich: die Vorwarnung, der certificate-check-Cron und die
 * Qualifikationsprüfung der Plantafel haben nichts, woran sie sich
 * zeigen könnten. Und genau das ist der Grund, warum ein Betrieb so
 * etwas führt — ein abgelaufener Nachweis auf dem Dach ist ein Problem,
 * das niemand am Tag der Montage entdecken will.
 */
export async function nachweise(c: Ctx): Promise<void> {
  const monteure = c.leute.filter((l) => l.role === "monteur");
  const bauleitung = c.leute.find((l) => l.role === "bauleitung")!;
  const lager = c.leute.find((l) => l.role === "lager")!;

  await c.db.from("qualification").delete().eq("company_id", c.company);

  const zeilen: Record<string, unknown>[] = [];
  const dazu = (userId: string, name: string, gueltigBis: string | null) => {
    zeilen.push({
      company_id: c.company,
      user_id: userId,
      name,
      issued_on: c.tag(-720),
      valid_until: gueltigBis,
    });
  };

  monteure.forEach((m, i) => {
    /* Die Elektro-Unterweisung läuft jährlich — gestaffelt, wie im Betrieb. */
    dazu(m.id, "Unterweisung Elektrotechnik §5 ETV", c.tag(120 + i * 45));
    dazu(m.id, "PSA gegen Absturz", c.tag(200 + i * 30));
  });

  /* Einer läuft bald ab — dafür gibt es die Vorwarnung. */
  if (monteure[0]) dazu(monteure[0].id, "Hubarbeitsbühne", c.tag(38));
  /* Und einer ist abgelaufen. Das darf man sehen. */
  if (monteure[1]) dazu(monteure[1].id, "Erste Hilfe (16 h)", c.tag(-21));

  dazu(bauleitung.id, "Blitzschutz-Fachkraft", c.tag(400));
  dazu(bauleitung.id, "Erste Hilfe (16 h)", c.tag(310));
  dazu(lager.id, "Staplerschein", c.tag(560));

  const { error } = await c.db.from("qualification").insert(zeilen);
  if (error) throw error;

  console.log(`  ${zeilen.length} Nachweise, einer läuft ab, einer ist abgelaufen`);
}
