import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Die Annahme eines Angebots — an einer Stelle.
 *
 * Ein Angebot kann auf zwei Wegen angenommen werden: im Backoffice, wenn
 * der Kunde am Telefon zusagt, und im Kundenportal über den Link. Beide
 * Wege müssen dasselbe tun, sonst hängt nach der Portalannahme ein
 * gewonnenes Angebot ohne Auftrag in der Pipeline — und genau das war
 * vorher der Fall, weil jeder Weg seine eigene Fassung mitgebracht hat.
 *
 * Definition of Done Meilenstein 3: Annahme legt den Auftrag an und
 * erzeugt die Aufgabe „Termin fixieren".
 *
 * Der Client kommt von außen. Im Backoffice ist es der RLS-Client des
 * angemeldeten Nutzers, im Portal der Service-Role-Client — dort ist die
 * Zugehörigkeit des Angebots zum Kunden schon geprüft, bevor hier
 * irgendetwas passiert.
 */

export type AnnahmeErgebnis =
  | { ok: true; jobId: string; jobNumber: string; quoteNumber: string; neu: boolean }
  | { ok: false; grund: string };

export type AnnahmeEingabe = {
  quoteId: string;
  companyId: string;
  name: string;
  /** Nur im Portal gesetzt — Nachweis, wer angenommen hat. */
  ip?: string | null;
  /** Landet im quote_event, damit man später sieht, woher die Zusage kam. */
  via: "backoffice" | "portal";
  /** Im Backoffice der annehmende Nutzer, im Portal niemand. */
  userId?: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

/*
 * Die Select-Strings sind zur Übersetzungszeit kein Schema, deshalb kommt
 * aus dem Client kein brauchbarer Zeilentyp zurück. Statt jeden Zugriff
 * einzeln zu casten steht die Form der gelesenen Zeilen hier einmal.
 */
type QuoteZeile = {
  id: string;
  number: string;
  net_total: string;
  cost_total: string;
  customer_id: string;
  accepted_at: string | null;
  customer: { address: string | null; zip: string | null; city: string | null } | null;
};

type PhasenZeile = {
  id: string;
  key: string;
  system_key: string | null;
  pipeline: { kind: string } | null;
};

export async function angebotAnnehmen(
  supabase: Client,
  eingabe: AnnahmeEingabe,
): Promise<AnnahmeErgebnis> {
  const { quoteId, companyId, name } = eingabe;

  const { data: quoteRoh } = await supabase
    .from("quote")
    .select(
      "id, number, net_total, cost_total, customer_id, accepted_at, " +
        "customer:customer_id ( address, zip, city )",
    )
    .eq("id", quoteId)
    .eq("company_id", companyId)
    .maybeSingle();

  const quote = quoteRoh as unknown as QuoteZeile | null;
  if (!quote) return { ok: false, grund: "Angebot nicht gefunden." };

  /*
   * Zweimal annehmen darf keinen zweiten Auftrag erzeugen. Das passiert
   * öfter als man denkt — der Kunde klickt im Portal, ruft danach an, und
   * im Büro klickt jemand nochmal.
   */
  const { data: bestehendRoh } = await supabase
    .from("job")
    .select("id, number")
    .eq("quote_id", quote.id)
    .maybeSingle();

  const bestehend = bestehendRoh as unknown as
    | { id: string; number: string }
    | null;

  if (bestehend) {
    return {
      ok: true,
      neu: false,
      jobId: bestehend.id,
      jobNumber: bestehend.number,
      quoteNumber: quote.number,
    };
  }

  const [{ data: phasen }, { data: nummer, error: nrFehler }, { data: standort }] =
    await Promise.all([
      supabase
        .from("pipeline_phase")
        .select("id, key, system_key, pipeline:pipeline_id ( kind )")
        .eq("company_id", companyId),
      supabase.rpc("next_number", { p_company: companyId, p_kind: "job" }),
      supabase
        .from("location")
        .select("id")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle(),
    ]);

  if (nrFehler || typeof nummer !== "string") {
    return { ok: false, grund: "Auftragsnummer konnte nicht vergeben werden." };
  }

  const alle = (phasen ?? []) as unknown as PhasenZeile[];

  const projekte = alle.filter((p) => p.pipeline?.kind === "projekte");
  /*
   * Startphase über den Schlüssel, ersatzweise die erste Projektphase.
   * Ein Mandant darf seine Phasen umbenennen, ohne dass die Annahme
   * stehenbleibt (CLAUDE.md Abschnitt 5, Punkt 1a).
   */
  const start = projekte.find((p) => p.key === "beauftragt") ?? projekte[0];
  if (!start) {
    return { ok: false, grund: "Die Projekte-Pipeline hat keine Startphase." };
  }

  const kunde = quote.customer;

  const { data: jobRoh, error: jobFehler } = await supabase
    .from("job")
    .insert({
      company_id: companyId,
      customer_id: quote.customer_id,
      quote_id: quote.id,
      location_id: standort?.id ?? null,
      number: nummer,
      phase_id: start.id,
      value_net: quote.net_total,
      material_planned: quote.cost_total,
      address: kunde?.address ?? null,
      zip: kunde?.zip ?? null,
      city: kunde?.city ?? null,
      next_step: "Termin fixieren",
      created_by: eingabe.userId ?? null,
    })
    .select("id, number")
    .single();

  const job = jobRoh as unknown as { id: string; number: string } | null;

  if (jobFehler || !job) {
    return {
      ok: false,
      grund: `Auftrag konnte nicht angelegt werden: ${jobFehler?.message ?? "unbekannt"}`,
    };
  }

  // Die Aufgabe hängt am Auftrag, nicht an einer Notiz — sie muss abhakbar sein.
  await supabase.from("job_checklist_item").insert({
    company_id: companyId,
    job_id: job.id,
    sort: 1,
    label: "Termin fixieren",
  });

  const won = alle.find(
    (p) => p.system_key === "won" && p.pipeline?.kind === "vertrieb",
  );

  await supabase
    .from("quote")
    .update({
      ...(won ? { phase_id: won.id } : {}),
      accepted_at: new Date().toISOString(),
      accepted_name: name,
      ...(eingabe.ip ? { accepted_ip: eingabe.ip } : {}),
    })
    .eq("id", quote.id);

  await supabase.from("quote_event").insert({
    company_id: companyId,
    quote_id: quote.id,
    kind: "accepted",
    meta_json: {
      by: name,
      job: job.number,
      via: eingabe.via,
      ...(eingabe.ip ? { ip: eingabe.ip } : {}),
    },
  });

  return {
    ok: true,
    neu: true,
    jobId: job.id,
    jobNumber: job.number,
    quoteNumber: quote.number,
  };
}
