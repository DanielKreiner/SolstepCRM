import { expect, test } from "@playwright/test";
import { COMPANY_A, admin } from "./helpers";

/*
 * Alle Cron-Endpunkte, die vercel.json ankündigt.
 *
 * Der Anlass für diesen Test: acht der neun angekündigten Pfade gab es
 * nicht. Auf Vercel wäre jeder Aufruf ins 404 gelaufen, sichtbar nur im
 * Deployment-Log. Der Test hält jetzt fest, dass jeder angekündigte Pfad
 * existiert, das Geheimnis verlangt und ein zweites Mal am selben Tag
 * nichts doppelt tut.
 */

const CRONS = [
  "/api/cron/quote-reminders",
  "/api/cron/dunning",
  "/api/cron/stock-check",
  "/api/cron/certificate-check",
  "/api/cron/graph-renew",
  "/api/cron/mail-send",
  "/api/cron/mail-fetch",
  "/api/cron/accounting-export",
  "/api/cron/monthly-timesheet",
  /* Aus der Einsatzplanung: Schutzabschaltung und Kundenerinnerung. */
  "/api/cron/zeit-schutz",
  "/api/cron/montage-erinnerung",
] as const;

function geheimnis(): string {
  const s = process.env.CRON_SECRET;
  if (!s) throw new Error("CRON_SECRET fehlt in .env.local");
  return s;
}

async function laeufeLoeschen() {
  await admin().from("job_run").delete().neq("kind", "");
}

test.describe.configure({ mode: "serial" });

test("vercel.json und die Route Handler stimmen überein", async () => {
  const { readFileSync } = await import("node:fs");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: { path: string }[];
  };
  const angekuendigt = vercel.crons.map((c) => c.path).sort();
  expect(angekuendigt).toEqual([...CRONS].sort());
});

test("kein Cron läuft ohne das Geheimnis", async ({ request }) => {
  for (const pfad of CRONS) {
    const ohne = await request.get(pfad);
    expect(ohne.status(), `${pfad} ohne Header`).toBe(401);

    const falsch = await request.get(pfad, {
      headers: { authorization: "Bearer falsch" },
    });
    expect(falsch.status(), `${pfad} mit falschem Geheimnis`).toBe(401);
  }
});

/*
 * Neun Cronläufe hintereinander gegen die echte Datenbank. Das dauert
 * länger als ein Klicktest und ist kein Zeichen für ein Problem — der
 * Standardrahmen von 45 Sekunden reicht dafür nicht.
 */
test("jeder Cron läuft durch und meldet ein Ergebnis", async ({ request }) => {
  test.setTimeout(240_000);
  await laeufeLoeschen();

  for (const pfad of CRONS) {
    const antwort = await request.get(pfad, {
      headers: { authorization: `Bearer ${geheimnis()}` },
    });

    expect(antwort.status(), `${pfad}: ${await antwort.text()}`).toBe(200);
    const koerper = await antwort.json();
    expect(koerper.ok, `${pfad} meldet kein ok`).toBe(true);
  }
});

test("ein zweiter Lauf im selben Fenster tut nichts", async ({ request }) => {
  test.setTimeout(240_000);
  for (const pfad of CRONS) {
    const zweiter = await request.get(pfad, {
      headers: { authorization: `Bearer ${geheimnis()}` },
    });
    expect(zweiter.status()).toBe(200);
    const koerper = await zweiter.json();
    expect(koerper.uebersprungen, `${pfad} lief doppelt`).toBe(
      "bereits gelaufen",
    );
  }
});

test("jeder Lauf hinterlässt eine Spur in job_run", async () => {
  const { data } = await admin().from("job_run").select("kind, result");
  const arten = new Set((data ?? []).map((r) => r.kind as string));

  for (const pfad of CRONS) {
    const kind = pfad.split("/").pop()!;
    expect(arten.has(kind), `${kind} ohne Eintrag in job_run`).toBe(true);
  }

  // Kein Lauf ist mit einem Fehler geendet.
  const fehler = (data ?? []).filter(
    (r) => (r.result as { fehler?: string } | null)?.fehler,
  );
  expect(
    fehler.map((f) => `${f.kind}: ${(f.result as { fehler: string }).fehler}`),
  ).toEqual([]);
});

test("Optionale Integrationen ruhen, statt Fehler zu werfen", async ({
  request,
}) => {
  await laeufeLoeschen();

  // Ohne Microsoft-Entra-App darf graph-renew nicht scheitern.
  const graph = await request.get("/api/cron/graph-renew", {
    headers: { authorization: `Bearer ${geheimnis()}` },
  });
  expect(graph.status()).toBe(200);
  const g = await graph.json();
  expect(g.ok).toBe(true);
  expect(g.erneuert).toBe(0);

  // Das Seed-Postfach steht auf 'unverified' — der Abruf ruht.
  const fetchLauf = await request.get("/api/cron/mail-fetch", {
    headers: { authorization: `Bearer ${geheimnis()}` },
  });
  const f = await fetchLauf.json();
  expect(f.ok).toBe(true);
  expect(f.konten).toBe(0);
});

test("Der Monatsabschluss lässt geprüfte Buchungen liegen", async ({
  request,
}) => {
  const db = admin();
  await laeufeLoeschen();

  // Eine Buchung im Vormonat, als geprüft markiert.
  const jetzt = new Date();
  const vormonat = new Date(
    Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth() - 1, 15, 6),
  );
  const { data: user } = await db
    .from("app_user")
    .select("id")
    .eq("email", "monteur@hofstaetter.example.com")
    .single();

  const { data: geprueft } = await db
    .from("time_entry")
    .insert({
      company_id: COMPANY_A,
      user_id: user!.id,
      kind: "work",
      started_at: vormonat.toISOString(),
      ended_at: new Date(vormonat.getTime() + 4 * 3600_000).toISOString(),
      note: "E2E-CRON geprüft",
      status: "flagged",
      flagged_reason: "Testfall",
    })
    .select("id")
    .single();

  const { data: normal } = await db
    .from("time_entry")
    .insert({
      company_id: COMPANY_A,
      user_id: user!.id,
      kind: "work",
      started_at: new Date(vormonat.getTime() + 86_400_000).toISOString(),
      ended_at: new Date(vormonat.getTime() + 86_400_000 + 4 * 3600_000).toISOString(),
      note: "E2E-CRON normal",
      status: "booked",
    })
    .select("id")
    .single();

  const antwort = await request.get("/api/cron/monthly-timesheet", {
    headers: { authorization: `Bearer ${geheimnis()}` },
  });
  expect(antwort.status()).toBe(200);

  const { data: nachher } = await db
    .from("time_entry")
    .select("id, status")
    .in("id", [geprueft!.id, normal!.id]);

  const map = new Map((nachher ?? []).map((e) => [e.id, e.status]));
  // Die normale Buchung ist abgeschlossen …
  expect(map.get(normal!.id)).toBe("approved");
  // … die geprüfte bleibt liegen, sie gehört einem Menschen vorgelegt.
  expect(map.get(geprueft!.id)).toBe("flagged");

  await db.from("time_entry").delete().like("note", "E2E-CRON%");
  await laeufeLoeschen();
});
