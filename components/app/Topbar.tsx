import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "./ThemeToggle";
import { Icon } from "@/components/ui/Icon";
import { initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/nav";
import { signOut } from "@/app/(app)/logout/actions";

type Props = {
  name: string;
  role: string;
  unread: number;
};

export function Topbar({ name, role, unread }: Props) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-[14px] rounded-[22px] bg-surface px-4 py-3 shadow-soft">
      <CommandPalette />

      <div className="hidden flex-1 lg:block" />

      <ThemeToggle />

      <button
        type="button"
        aria-label={
          unread > 0 ? `${unread} ungelesene Hinweise` : "Keine neuen Hinweise"
        }
        className="relative flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors duration-200 hover:text-ink"
      >
        <Icon name="glocke" size={18} />
        {unread > 0 ? (
          <span className="absolute top-[6px] right-[6px] h-2 w-2 rounded-pill bg-s-crit" />
        ) : null}
      </button>

      <div className="flex items-center gap-[11px] pl-[6px]">
        <span
          aria-hidden
          className="flex h-[42px] w-[42px] items-center justify-center rounded-pill bg-s-doing text-sm font-semibold text-white"
        >
          {initials(name)}
        </span>
        <span className="hidden sm:block">
          <span className="block text-sm font-semibold tracking-[-0.01em]">
            {name}
          </span>
          <span className="block text-xs text-muted">
            {ROLE_LABEL[role] ?? role}
          </span>
        </span>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Abmelden"
            className="flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors duration-200 hover:text-ink"
          >
            <Icon name="abmelden" size={18} />
          </button>
        </form>
      </div>
    </header>
  );
}
