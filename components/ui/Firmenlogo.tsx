import { BRAND, BRAND_MARK } from "@/lib/brand";

/**
 * Das Logo des Betriebs — mit Rückfall auf das Produktzeichen.
 *
 * Eine Stelle für alle: Portal, Backoffice, Monteur-App. Ohne sie hätte
 * jede Oberfläche ihren eigenen kleinen Rückfall, und beim ersten
 * Mandanten ohne Logo sähe eine davon kaputt aus.
 *
 * Kein next/image: die Adresse zeigt in den Storage des Mandanten, die
 * Grösse steht nicht fest, und für ein Logo lohnt keine Optimierung.
 */
export function Firmenlogo({
  logoUrl,
  firma,
  hoehe = 32,
  /** Firmenname daneben. Aus, wo er ohnehin schon steht. */
  mitName = true,
}: {
  logoUrl: string | null;
  firma: string;
  hoehe?: number;
  mitName?: boolean;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={firma}
        style={{ height: hoehe }}
        className="w-auto max-w-[180px] object-contain"
      />
    );
  }

  /*
   * Ohne Logo das Produktzeichen und der Firmenname. Nicht der
   * Produktname: in der Software des Betriebs steht der Betrieb.
   */
  return (
    <span className="flex items-center gap-[11px]">
      <span
        aria-hidden
        style={{ height: hoehe, width: hoehe }}
        className="flex shrink-0 items-center justify-center rounded-[11px] bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[15px] font-bold text-white"
      >
        {BRAND_MARK}
      </span>
      {mitName ? (
        <span className="truncate text-[17px] font-bold tracking-[-0.025em]">
          {firma || BRAND.name}
        </span>
      ) : null}
    </span>
  );
}
