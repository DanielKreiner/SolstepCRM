import { describe, expect, it } from "vitest";
import { mailStatus, tage, type QuoteEvent } from "./quote-status";

const HEUTE = "2026-08-01";

const basis = {
  status: "sent",
  sent_at: "2026-07-30T10:00:00Z",
  accepted_at: null as string | null,
  valid_until: "2026-08-30",
};

function ereignis(kind: string, tag: string): QuoteEvent {
  return { kind, created_at: `${tag}T10:00:00Z` };
}

describe("mailStatus", () => {
  it("meldet einen Entwurf als nicht gesendet", () => {
    const r = mailStatus(
      { status: "draft", sent_at: null, accepted_at: null, valid_until: null },
      [],
      HEUTE,
    );
    expect(r.status).toBe("entwurf");
    expect(r.detail).toBe("nicht gesendet");
  });

  it("zählt Öffnungen und schreibt sie in die Detailzeile", () => {
    const r = mailStatus(
      basis,
      [
        ereignis("opened", "2026-07-30"),
        ereignis("opened", "2026-07-31"),
        ereignis("opened", "2026-08-01"),
      ],
      HEUTE,
    );
    expect(r.status).toBe("geoeffnet");
    expect(r.detail).toBe("3× geöffnet");
  });

  it("nennt eine einzelne Öffnung im Singular", () => {
    const r = mailStatus(basis, [ereignis("opened", "2026-07-30")], HEUTE);
    expect(r.detail).toBe("1× geöffnet");
  });

  it("wird nach sieben Tagen ohne Regung still", () => {
    const r = mailStatus(
      { ...basis, sent_at: "2026-07-20T10:00:00Z" },
      [ereignis("opened", "2026-07-21")],
      HEUTE,
    );
    expect(r.status).toBe("still");
    expect(r.detail).toContain("11 Tagen");
  });

  it("unterscheidet still-ungeöffnet von still-nach-Öffnung", () => {
    const ohne = mailStatus(
      { ...basis, sent_at: "2026-07-20T10:00:00Z" },
      [],
      HEUTE,
    );
    expect(ohne.status).toBe("still");
    expect(ohne.detail).toContain("ungeöffnet");
  });

  it("zählt einen Klick auf den Annahme-Link als Regung", () => {
    // Versand vor 12 Tagen, aber gestern wurde der Link geklickt.
    const r = mailStatus(
      { ...basis, sent_at: "2026-07-20T10:00:00Z" },
      [ereignis("opened", "2026-07-21"), ereignis("link_clicked", "2026-07-31")],
      HEUTE,
    );
    expect(r.status).toBe("geoeffnet");
  });

  it("setzt Annahme über alles andere", () => {
    const r = mailStatus(
      { ...basis, accepted_at: "2026-07-31T09:00:00Z" },
      [ereignis("opened", "2026-07-30")],
      HEUTE,
    );
    expect(r.status).toBe("angenommen");
    expect(r.ton).toBe("done");
  });

  it("meldet ein abgelaufenes Angebot als kritisch", () => {
    const r = mailStatus(
      { ...basis, valid_until: "2026-07-31" },
      [ereignis("opened", "2026-07-30")],
      HEUTE,
    );
    expect(r.status).toBe("abgelaufen");
    expect(r.ton).toBe("crit");
  });

  it("lässt ein angenommenes Angebot nicht ablaufen", () => {
    // Angenommen am 20.07., Gültigkeit endete am 31.07. — das Angebot ist
    // trotzdem angenommen und nicht abgelaufen.
    const r = mailStatus(
      {
        ...basis,
        accepted_at: "2026-07-20T09:00:00Z",
        valid_until: "2026-07-31",
      },
      [],
      HEUTE,
    );
    expect(r.status).toBe("angenommen");
  });

  it("behauptet nie eine Zustellung", () => {
    // Ohne Versanddienst gibt es kein delivered-Ereignis, das man glauben
    // dürfte (CLAUDE.md 6.1). Der Status darf das nicht suggerieren.
    const alle = [
      mailStatus(basis, [], HEUTE),
      mailStatus(basis, [ereignis("sent", "2026-07-30")], HEUTE),
    ];
    for (const r of alle) {
      expect(r.label).not.toContain("zugestellt");
      expect(r.detail).not.toContain("zugestellt");
    }
  });
});

describe("tage", () => {
  it("zählt Kalendertage und wird nicht negativ", () => {
    expect(tage("2026-07-25", HEUTE)).toBe(7);
    expect(tage("2026-08-05", HEUTE)).toBe(0);
  });
});
