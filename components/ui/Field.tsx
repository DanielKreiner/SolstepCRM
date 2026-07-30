import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Klartext-Fehler direkt am Feld. Kein stiller Fehler — Abschnitt 10. */
  error?: string | undefined;
  /** Zahlen, IDs und Betraege in Mono. */
  mono?: boolean;
};

export function Field({
  label,
  error,
  mono = false,
  id,
  className = "",
  ...rest
}: Props) {
  const inputId = id ?? `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const errorId = `${inputId}-fehler`;

  return (
    <div className={`flex flex-col gap-[7px] ${className}`}>
      <label
        htmlFor={inputId}
        className="text-[12.5px] font-semibold text-muted"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={[
          "w-full rounded-input bg-sunk px-[13px] py-[11px] text-sm text-ink",
          "border outline-0 transition-colors duration-200 ease-out-quint",
          "placeholder:text-faint",
          "focus:border-accent focus:bg-surface",
          error ? "border-s-crit" : "border-transparent",
          mono ? "num" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      />
      {error ? (
        <span id={errorId} className="text-[12px] font-medium text-s-crit">
          {error}
        </span>
      ) : null}
    </div>
  );
}
