"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { NAV, isActive } from "@/lib/nav";
import { BRAND, BRAND_MARK } from "@/lib/brand";

type Props = {
  companyName: string;
  locationName: string;
  /** Bereiche, die diese Rolle mindestens lesen darf. */
  visibleAreas: string[];
  badges?: Record<string, number>;
};

export function Sidebar({
  companyName,
  locationName,
  visibleAreas,
  badges = {},
}: Props) {
  const pathname = usePathname();
  const allowed = new Set(visibleAreas);

  return (
    <aside className="flex w-[var(--sidebar-w)] shrink-0 flex-col overflow-hidden rounded-panel bg-surface shadow-soft">
      <div className="flex items-center gap-[11px] px-5 pt-[22px] pb-2">
        <span
          aria-hidden
          className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-[linear-gradient(150deg,var(--accent-from),var(--accent-to))] text-[15px] font-bold text-white"
        >
          {BRAND_MARK}
        </span>
        <span className="text-[19px] font-bold tracking-[-0.025em]">
          {BRAND.name}
        </span>
      </div>

      <div className="mx-[14px] mt-[14px] mb-1 flex items-center gap-[10px] rounded-input bg-sunk px-[11px] py-[10px] text-left">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-icon bg-surface text-accent">
          <Icon name="standort" size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold">
            {companyName}
          </span>
          <span className="block truncate text-[11px] text-muted">
            {locationName}
          </span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-2">
        {NAV.map((group) => {
          const items = group.items.filter(
            (i) => i.area === null || allowed.has(i.area),
          );
          if (items.length === 0) return null;

          return (
            <div key={group.title} className="mb-[18px]">
              <div className="px-[10px] pt-1 pb-2 text-[10.5px] font-semibold tracking-[0.12em] text-faint uppercase">
                {group.title}
              </div>
              <div className="flex flex-col gap-[3px]">
                {items.map((item) => {
                  const on = isActive(item.href, pathname);
                  const badge = badges[item.href];

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={on ? "page" : undefined}
                      className={[
                        "relative flex items-center gap-3 rounded-input px-[11px] py-[10px] text-[14.5px]",
                        "transition-colors duration-200 ease-out-quint",
                        on
                          ? "bg-sunk font-semibold text-ink"
                          : "font-normal text-muted hover:bg-sunk/60 hover:text-ink",
                      ].join(" ")}
                    >
                      <span
                        aria-hidden
                        className={[
                          "absolute top-3 bottom-3 -left-3 w-1 rounded-pill",
                          on ? "bg-accent" : "bg-transparent",
                        ].join(" ")}
                      />
                      <span
                        className={[
                          "flex h-[26px] w-[26px] items-center justify-center rounded-icon",
                          on ? "bg-accent text-white" : "bg-panel text-faint",
                        ].join(" ")}
                      >
                        <Icon name={item.icon} size={15} />
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge ? (
                        <span className="num rounded-pill bg-panel px-[7px] py-[1.5px] text-[10.5px] text-faint">
                          {badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
