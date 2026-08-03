"use client";

import { useState } from "react";

export type AnhangAnzeige = {
  id: string;
  dateiname: string;
  mime: string;
  groesseBytes: number;
  url: string | null;
};

/**
 * Anhänge unter einer Nachricht.
 *
 * Bilder als Vorschau, alles andere als Link. Ein PDF als kaputtes Bild
 * anzuzeigen hilft niemandem, und ein Foto hinter einem Dateinamen zu
 * verstecken auch nicht — der Techniker will den Zählerkasten sehen,
 * ohne zu klicken.
 */
export function Anhaenge({ anhaenge }: { anhaenge: AnhangAnzeige[] }) {
  if (anhaenge.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {anhaenge.map((a) => (
        <li key={a.id}>
          {a.mime.startsWith("image/") && a.url ? (
            <Bild url={a.url} name={a.dateiname} />
          ) : (
            <a
              href={a.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-input bg-surface px-3 py-2 text-[12px] font-medium text-accent-ink underline"
            >
              {a.dateiname}
              <span className="num text-[10.5px] text-faint">
                {Math.round(a.groesseBytes / 1024)} KB
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function Bild({ url, name }: { url: string; name: string }) {
  const [gross, setGross] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setGross(true)}
        aria-label={`${name} vergrössern`}
        className="cursor-pointer overflow-hidden rounded-card border-0 bg-panel p-0"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          loading="lazy"
          className="h-[96px] w-[96px] object-cover"
        />
      </button>

      {gross ? (
        <div
          role="dialog"
          aria-label={name}
          onClick={() => setGross(false)}
          className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-ink/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={name}
            className="max-h-full max-w-full rounded-card object-contain"
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * Dateiauswahl mit Rückmeldung, was ausgewählt ist.
 *
 * Ohne die weiss niemand, ob das Foto wirklich dran hängt — und am Handy
 * ist genau das die häufigste Unsicherheit.
 */
export function DateiFeld({
  id,
  name = "anhang",
  label,
  pflicht = false,
}: {
  id: string;
  name?: string;
  label: string;
  pflicht?: boolean;
}) {
  const [namen, setNamen] = useState<string[]>([]);

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-[5px] block text-[12px] font-medium text-muted"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="file"
        multiple
        required={pflicht}
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        onChange={(e) =>
          setNamen([...(e.target.files ?? [])].map((f) => f.name))
        }
        className="w-full text-[12.5px] file:mr-3 file:cursor-pointer file:rounded-pill file:border-0 file:bg-sunk file:px-4 file:py-2 file:text-[12.5px] file:font-medium"
      />
      {namen.length > 0 ? (
        <p className="mt-1 text-[11.5px] text-s-done">
          {namen.length === 1 ? namen[0] : `${namen.length} Dateien`} ausgewählt
        </p>
      ) : (
        <p className="mt-1 text-[10.5px] text-faint">
          Bilder oder PDF, höchstens 25 MB. Standortdaten werden vor dem
          Ablegen aus Fotos entfernt.
        </p>
      )}
    </div>
  );
}
