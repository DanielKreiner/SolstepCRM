import { PageHeader } from "./PageHeader";

/*
 * Übergangszustand, bis der zugehörige Meilenstein gebaut ist.
 * Bewusst nüchtern: keine Illustration, kein "Bald verfügbar!" — es steht
 * dran, was fehlt und wann es kommt.
 */
export function Placeholder({
  title,
  milestone,
  scope,
}: {
  title: string;
  milestone: number;
  scope: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={`Meilenstein ${milestone}`} />
      <div className="max-w-[620px] rounded-[20px] bg-surface p-6 shadow-soft">
        <p className="text-[13.5px] text-muted">{scope}</p>
      </div>
    </>
  );
}
