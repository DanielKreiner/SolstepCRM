import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "quiet";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Volle Breite, z. B. in Formularen. */
  block?: boolean;
};

/*
 * Masse aus den Mockups: Pill-Radius, Verlauf 150deg, 13px/22px Innenabstand,
 * getragener Schatten in Akzentfarbe. Nicht "verbessern" — Abschnitt 13.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "text-white font-semibold bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] " +
    "shadow-[0_6px_18px_rgba(201,121,24,0.28)] hover:brightness-[1.04] active:brightness-95",
  ghost:
    "bg-surface text-ink font-medium border border-line hover:bg-sunk",
  quiet: "bg-sunk text-ink font-medium hover:bg-line",
};

export function Button({
  variant = "primary",
  block = false,
  className = "",
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center gap-[9px] rounded-pill px-[22px] py-[13px]",
        "text-sm cursor-pointer border-0 transition-[filter,background-color] duration-200 ease-out-quint",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        VARIANTS[variant],
        block ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}

/*
 * Derselbe Knopf als Navigation. Getrennt gehalten, weil ein <button> mit
 * router.push() die Mittelklick- und Kontextmenue-Erwartung bricht: eine
 * Aktion, die den Screen wechselt, gehoert in ein <a>.
 */
export function LinkButton({
  href,
  variant = "primary",
  block = false,
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  block?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={[
        "inline-flex items-center justify-center gap-[9px] rounded-pill px-[22px] py-[13px]",
        "text-sm no-underline transition-[filter,background-color] duration-200 ease-out-quint",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        // Die Variantenklassen setzen die Textfarbe; der globale a-Stil
        // wuerde sie sonst auf die Akzentfarbe ziehen.
        variant === "primary" ? "hover:text-white" : "text-ink hover:text-ink",
        VARIANTS[variant],
        block ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Link>
  );
}
