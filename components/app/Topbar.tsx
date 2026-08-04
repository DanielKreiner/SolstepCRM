import Link from "next/link";
import { CommandPalette } from "./CommandPalette";
import { MobileNav } from "./MobileNav";
import { ThemeToggle } from "./ThemeToggle";
import { Icon } from "@/components/ui/Icon";
import { initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/nav";
import { signOut } from "@/app/(app)/logout/actions";

type Props = {
  name: string;
  role: string;
  unread: number;
  nav: {
    companyName: string;
    logoUrl: string | null;
    locationName: string;
    visibleAreas: string[];
    badges?: Record<string, number>;
  };
};

export function Topbar({ name, role, unread, nav }: Props) {
  return (
    /*
     * Am Telefon eine Zeile, nicht zwei: flex-wrap liess die Leiste
     * umbrechen und frass ein Sechstel des Bildschirms, bevor der Inhalt
     * anfing. Was nicht in eine Zeile passt, wird dort ausgeblendet.
     */
    <header className="flex shrink-0 items-center gap-2 rounded-[22px] bg-surface px-3 py-[10px] shadow-soft sm:gap-[14px] sm:px-4 sm:py-3">
      <MobileNav {...nav} />

      <CommandPalette />

      <div className="hidden flex-1 lg:block" />

      <span className="hidden sm:block">
        <ThemeToggle />
      </span>

      <button
        type="button"
        aria-label={
          unread > 0 ? `${unread} ungelesene Hinweise` : "Keine neuen Hinweise"
        }
        className="relative hidden h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors duration-200 hover:text-ink sm:flex"
      >
        <Icon name="glocke" size={18} />
        {unread > 0 ? (
          <span className="absolute top-[6px] right-[6px] h-2 w-2 rounded-pill bg-s-crit" />
        ) : null}
      </button>

      <div className="flex shrink-0 items-center gap-[11px] sm:pl-[6px]">
        <span
          aria-hidden
          className="flex h-[38px] w-[38px] items-center justify-center rounded-pill bg-s-doing text-sm font-semibold text-white sm:h-[42px] sm:w-[42px]"
        >
          {initials(name)}
        </span>
        <span className="hidden lg:block">
          <span className="block text-sm font-semibold tracking-[-0.01em]">
            {name}
          </span>
          <span className="block text-xs text-muted">
            {ROLE_LABEL[role] ?? role}
          </span>
        </span>
        {/*
          Der eigene Arbeitstag steht hier und nicht in der
          Hauptnavigation: dort geht es um den Betrieb, hier um einen
          selbst. Wer im Büro sitzt, stempelt trotzdem gelegentlich.
        */}
        <Link
          href="/m/heute"
          data-testid="mein-bereich"
          aria-label="Mein Bereich"
          title="Mein Bereich — eigene Zeiten und Dokumente"
          className="flex h-[38px] w-[38px] items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors duration-200 hover:text-ink sm:h-[42px] sm:w-[42px]"
        >
          <Icon name="einsatz" size={18} />
        </Link>

        <form action={signOut}>
          <button
            type="submit"
            aria-label="Abmelden"
            className="flex h-[38px] w-[38px] cursor-pointer items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors duration-200 hover:text-ink sm:h-[42px] sm:w-[42px]"
          >
            <Icon name="abmelden" size={18} />
          </button>
        </form>
      </div>
    </header>
  );
}
