import { describe, expect, it } from "vitest";
import { blockiert, pruefe, type Pruefung } from "./konflikte";

/*
 * Die Abnahmetests 2 bis 6 aus dem Planungsbriefing, als Unit-Test.
 * Sie prüfen die Regel und nicht die Oberfläche — genau hier entscheidet
 * sich, ob ein Monteur im Urlaub eingeplant werden kann.
 */

const WALLNER = { id: "u1", name: "Stefan Wallner", qualifikationen: ["elektriker"] };
const BERGER = { id: "u2", name: "Lukas Berger", qualifikationen: [] };

function basis(ueber: Partial<Pruefung> = {}): Pruefung {
  return {
    neu: {
      id: "neu",
      von: "2026-08-12T06:00:00Z",
      bis: "2026-08-12T14:00:00Z",
      personen: [WALLNER.id],
      fahrzeugId: null,
      titel: "Montage Sifkovits",
    },
    bestand: [],
    personen: [WALLNER, BERGER],
    abwesenheiten: [],
    benoetigt: [],
    fahrzeuge: [{ id: "f1", name: "Bus 1" }],
    ...ueber,
  };
}

describe("Abwesenheit blockiert", () => {
  it("lässt sich nicht speichern, wenn die Person Urlaub hat", () => {
    const k = pruefe(
      basis({
        abwesenheiten: [
          { userId: WALLNER.id, von: "2026-08-10", bis: "2026-08-14", art: "vacation" },
        ],
      }),
    );
    expect(blockiert(k)).toBe(true);
    expect(k[0]?.code).toBe("abwesend");
    expect(k[0]?.text).toContain("Urlaub");
  });

  /* Ein Urlaub, der am Vortag endet, ist kein Konflikt. */
  it("greift nicht ausserhalb des Zeitraums", () => {
    const k = pruefe(
      basis({
        abwesenheiten: [
          { userId: WALLNER.id, von: "2026-08-05", bis: "2026-08-11", art: "vacation" },
        ],
      }),
    );
    expect(blockiert(k)).toBe(false);
  });

  it("betrifft nur die abwesende Person", () => {
    const k = pruefe(
      basis({
        neu: { ...basis().neu, personen: [BERGER.id] },
        abwesenheiten: [
          { userId: WALLNER.id, von: "2026-08-10", bis: "2026-08-14", art: "sick" },
        ],
      }),
    );
    expect(blockiert(k)).toBe(false);
  });
});

describe("Doppelbelegung warnt, blockiert aber nicht", () => {
  it("meldet eine Person in zwei überlappenden Einsätzen", () => {
    const k = pruefe(
      basis({
        bestand: [
          {
            id: "alt",
            von: "2026-08-12T07:00:00Z",
            bis: "2026-08-12T12:00:00Z",
            personen: [WALLNER.id],
            fahrzeugId: null,
            titel: "Service Gruber",
          },
        ],
      }),
    );
    const d = k.find((x) => x.code === "doppelt");
    expect(d?.stufe).toBe("weich");
    expect(d?.text).toContain("Service Gruber");
    expect(blockiert(k)).toBe(false);
  });

  /*
   * Anschluss ohne Überlappung: 14:00 Ende, 14:00 Beginn. Das ist kein
   * Konflikt, sonst warnt die Tafel bei jedem normalen Tagesablauf.
   */
  it("wertet Berührung am Rand nicht als Überschneidung", () => {
    const k = pruefe(
      basis({
        bestand: [
          {
            id: "alt",
            von: "2026-08-12T14:00:00Z",
            bis: "2026-08-12T16:00:00Z",
            personen: [WALLNER.id],
            fahrzeugId: null,
            titel: "Nachmittag",
          },
        ],
      }),
    );
    expect(k.some((x) => x.code === "doppelt")).toBe(false);
  });

  it("meldet den eigenen Einsatz beim Verschieben nicht", () => {
    const k = pruefe(
      basis({
        bestand: [
          {
            id: "neu",
            von: "2026-08-12T06:00:00Z",
            bis: "2026-08-12T14:00:00Z",
            personen: [WALLNER.id],
            fahrzeugId: null,
            titel: "derselbe",
          },
        ],
      }),
    );
    expect(k.some((x) => x.code === "doppelt")).toBe(false);
  });
});

describe("Fahrzeug", () => {
  it("warnt, wenn dasselbe Fahrzeug zweimal verplant ist", () => {
    const k = pruefe(
      basis({
        neu: { ...basis().neu, fahrzeugId: "f1" },
        bestand: [
          {
            id: "alt",
            von: "2026-08-12T08:00:00Z",
            bis: "2026-08-12T10:00:00Z",
            personen: [BERGER.id],
            fahrzeugId: "f1",
            titel: "Servicetag Nord",
          },
        ],
      }),
    );
    const f = k.find((x) => x.code === "fahrzeug");
    expect(f?.stufe).toBe("weich");
    expect(f?.text).toContain("Bus 1");
  });

  it("stört sich nicht an einem anderen Fahrzeug", () => {
    const k = pruefe(
      basis({
        neu: { ...basis().neu, fahrzeugId: "f1" },
        bestand: [
          {
            id: "alt",
            von: "2026-08-12T08:00:00Z",
            bis: "2026-08-12T10:00:00Z",
            personen: [BERGER.id],
            fahrzeugId: "f2",
            titel: "anderes",
          },
        ],
      }),
    );
    expect(k.some((x) => x.code === "fahrzeug")).toBe(false);
  });
});

describe("Arbeitszeitregeln", () => {
  it("warnt bei überschrittener Tageshöchstarbeitszeit und nennt die Regel", () => {
    const k = pruefe(
      basis({
        neu: {
          ...basis().neu,
          von: "2026-08-12T04:00:00Z",
          bis: "2026-08-12T17:00:00Z" /* 13 Stunden */,
        },
      }),
    );
    const t = k.find((x) => x.code === "tageshoechst");
    expect(t?.stufe).toBe("weich");
    expect(t?.regel).toContain("AZG");
    expect(blockiert(k)).toBe(false);
  });

  it("warnt bei zu kurzer Ruhezeit zum Vortag", () => {
    const k = pruefe(
      basis({
        bestand: [
          {
            id: "gestern",
            von: "2026-08-11T06:00:00Z",
            bis: "2026-08-11T20:00:00Z",
            personen: [WALLNER.id],
            fahrzeugId: null,
            titel: "langer Tag",
          },
        ],
      }),
    );
    /* 20:00 bis 06:00 sind 10 Stunden, gefordert sind 11. */
    expect(k.some((x) => x.code === "ruhezeit")).toBe(true);
  });
});

describe("Qualifikation", () => {
  it("warnt, wenn im Team niemand die geforderte Qualifikation hat", () => {
    const k = pruefe(
      basis({
        neu: { ...basis().neu, personen: [BERGER.id] },
        benoetigt: ["elektriker"],
      }),
    );
    const q = k.find((x) => x.code === "qualifikation");
    expect(q?.stufe).toBe("weich");
    expect(q?.text).toContain("elektriker");
  });

  it("schweigt, wenn jemand im Team sie hat", () => {
    const k = pruefe(
      basis({
        neu: { ...basis().neu, personen: [WALLNER.id, BERGER.id] },
        benoetigt: ["elektriker"],
      }),
    );
    expect(k.some((x) => x.code === "qualifikation")).toBe(false);
  });

  /* Ein Einsatz ohne Zuordnung ist kein Fehler, aber ein Hinweis wert. */
  it("meldet einen Einsatz ohne Personen, wenn etwas gefordert ist", () => {
    const k = pruefe(
      basis({ neu: { ...basis().neu, personen: [] }, benoetigt: ["hoehenarbeit"] }),
    );
    expect(k.find((x) => x.code === "qualifikation")?.text).toContain(
      "Noch niemand zugeordnet",
    );
  });
});
