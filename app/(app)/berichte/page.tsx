import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { BERICHTE, baueBericht, istBerichtId, jahresZeitraum } from "@/lib/reports";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Berichte" };

export default async function BerichtePage({
  searchParams,
}: {
  searchParams: Promise<{ bericht?: string; jahr?: string }>;
}) {
  const me = await requireMe();
  if (me.perms.berichte === "none") {
    return (
      <>
        <PageHeader title="Berichte" />
        <div className="rounded-[20px] bg-surface p-6 text-[13px] text-muted shadow-soft">
          Für Berichte fehlt deiner Rolle das Leserecht.
        </div>
      </>
    );
  }

  const sp = await searchParams;
  const id = sp.bericht ?? "auftraege";
  if (!istBerichtId(id)) notFound();

  const jahr = /^\d{4}$/.test(sp.jahr ?? "")
    ? Number(sp.jahr)
    : new Date().getFullYear();

  const bericht = await baueBericht(id, jahresZeitraum(jahr));

  const summen = bericht.spalten
    .filter((s) => s.numerisch)
    .map((s) => ({
      key: s.key,
      label: s.label,
      wert: bericht.zeilen.reduce((sum, z) => sum + Number(z[s.key] ?? 0), 0),
    }));

  const template = bericht.spalten
    .map((s) => (s.numerisch ? "130px" : "minmax(140px, 1fr)"))
    .join(" ");

  return (
    <>
      <PageHeader
        title="Berichte"
        subtitle={`${bericht.titel} · ${jahr}`}
        actions={
          <>
            <a
              href={`/api/export/report?bericht=${id}&jahr=${jahr}&format=csv`}
              className="rounded-pill border border-line bg-surface px-5 py-[13px] text-sm font-medium text-ink transition-colors hover:bg-sunk"
            >
              Excel (CSV)
            </a>
            <a
              href={`/api/export/report?bericht=${id}&jahr=${jahr}&format=pdf`}
              className="rounded-pill bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] px-5 py-[13px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,121,24,0.28)]"
            >
              PDF
            </a>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav className="flex flex-wrap gap-[3px] rounded-pill bg-surface p-1 shadow-soft">
          {BERICHTE.map((b) => (
            <Link
              key={b.id}
              href={`/berichte?bericht=${b.id}&jahr=${jahr}`}
              className={[
                "rounded-pill px-[17px] py-[9px] text-[13.5px] transition-colors",
                b.id === id
                  ? "bg-sunk font-semibold text-ink"
                  : "font-normal text-muted hover:text-ink",
              ].join(" ")}
            >
              {b.label}
            </Link>
          ))}
        </nav>

        <nav className="flex gap-1 rounded-pill bg-surface p-1 shadow-soft">
          {[jahr - 1, jahr, jahr + 1].map((j) => (
            <Link
              key={j}
              href={`/berichte?bericht=${id}&jahr=${j}`}
              className={[
                "num rounded-pill px-[15px] py-[9px] text-[13.5px]",
                j === jahr
                  ? "bg-sunk font-semibold text-ink"
                  : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {j}
            </Link>
          ))}
        </nav>
      </div>

      {summen.length > 0 ? (
        <div className="mb-4 grid gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Zeilen" value={bericht.zeilen.length} />
          {summen.slice(0, 3).map((s) => (
            <Stat
              key={s.key}
              label={`Summe ${s.label}`}
              value={new Intl.NumberFormat("de-AT", {
                maximumFractionDigits: 2,
              }).format(Math.round(s.wert * 100) / 100)}
            />
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[20px] bg-surface shadow-soft">
        <div style={{ minWidth: `${bericht.spalten.length * 140}px` }}>
          <div
            className="grid border-b border-line px-5 text-[11px] tracking-[0.07em] text-faint uppercase"
            style={{ gridTemplateColumns: template }}
          >
            {bericht.spalten.map((s) => (
              <div
                key={s.key}
                className={`px-[6px] py-[14px] ${s.numerisch ? "text-right" : ""}`}
              >
                {s.label}
              </div>
            ))}
          </div>

          {bericht.zeilen.length === 0 ? (
            <p className="px-5 py-8 text-[13.5px] text-muted">
              Für {jahr} gibt es dazu keine Daten.
            </p>
          ) : (
            bericht.zeilen.map((z, i) => (
              <div
                key={i}
                className="grid items-center border-b border-line px-5 last:border-b-0"
                style={{ gridTemplateColumns: template }}
              >
                {bericht.spalten.map((s) => (
                  <div
                    key={s.key}
                    className={[
                      "px-[6px] py-[10px] text-[13px]",
                      s.numerisch ? "num text-right" : "",
                    ].join(" ")}
                  >
                    {typeof z[s.key] === "number"
                      ? new Intl.NumberFormat("de-AT", {
                          maximumFractionDigits: 2,
                        }).format(z[s.key] as number)
                      : (z[s.key] ?? "—")}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <p className="mt-3 text-[12px] text-faint">{bericht.hinweis}</p>
    </>
  );
}
