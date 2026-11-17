"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { createClient } from "@/lib/supabase/client";

/*
 * Die Glocke in der Leiste.
 *
 * Sie war ein Knopf ohne Handler — rot gepunktet, aber ohne jede
 * Wirkung. Im Demotermin ist das der schlechteste denkbare Klick: Der
 * Betrieb sieht eine Zahl, drückt darauf und es passiert nichts.
 *
 * Jetzt hängt daran die Liste der eigenen Mitteilungen, die sich über
 * Realtime von selbst nachführt, und auf Wunsch eine Benachrichtigung
 * des Browsers.
 *
 * Zur Browserbenachrichtigung: Sie erscheint nur, wenn das Fenster NICHT
 * im Vordergrund ist. Wer ohnehin auf die Anwendung schaut, sieht die
 * Glocke rot werden — ihm zusätzlich ein Fenster vor die Nase zu setzen,
 * ist die Art von Software, die man nach drei Tagen stummschaltet.
 *
 * Das ist noch kein Web Push: Es wirkt, solange ein Fenster offen ist.
 * Für Benachrichtigungen bei geschlossenem Browser braucht es
 * VAPID-Schlüssel, eine Tabelle mit Abonnements und einen Versandweg —
 * das ist ein eigener Bau und steht noch aus.
 */

export type Mitteilung = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: string;
  created_at: string;
  read_at: string | null;
};

const MAX = 20;

function wannText(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  const std = Math.round(min / 60);
  if (std < 24) return `vor ${std} h`;
  const tage = Math.round(std / 24);
  return tage === 1 ? "gestern" : `vor ${tage} Tagen`;
}

export function Mitteilungen({ anfangsZahl }: { anfangsZahl: number }) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [liste, setListe] = useState<Mitteilung[] | null>(null);
  const [ungelesen, setUngelesen] = useState(anfangsZahl);
  const [erlaubnis, setErlaubnis] = useState<NotificationPermission | null>(null);
  const huelle = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setErlaubnis(Notification.permission);
    }
  }, []);

  const laden = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notification")
      .select("id, title, body, link, kind, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(MAX);
    setListe((data ?? []) as Mitteilung[]);
  }, []);

  /*
   * Realtime.
   *
   * Der Kanal muss die Sitzung kennen, bevor er abonniert. Ohne
   * `setAuth` lauscht er mit dem anon-Schluessel, und dann greift die
   * Policy aus 0075 gegen einen Unbekannten: Die Verbindung steht,
   * meldet brav SUBSCRIBED — und es kommt nie etwas an. Genau so ist es
   * hier zuerst gebaut gewesen, und es sieht aus wie ein stiller
   * Totalausfall, obwohl alles verbunden ist.
   *
   * Gefiltert wird dadurch serverseitig: Es kommt nur an, was diese
   * Sitzung auch lesen duerfte.
   */
  useEffect(() => {
    const supabase = createClient();
    let kanal: ReturnType<typeof supabase.channel> | null = null;
    let abgebrochen = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || abgebrochen) return;
      await supabase.realtime.setAuth(token);

      kanal = supabase
        .channel("mitteilungen")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notification" },
          (nachricht) => {
            const neue = nachricht.new as Mitteilung;
            setUngelesen((n) => n + 1);
            setListe((alt) =>
              alt === null ? alt : [neue, ...alt].slice(0, MAX),
            );

            /*
             * Nur wenn das Fenster nicht im Vordergrund ist. Wer ohnehin
             * hinschaut, sieht die Glocke rot werden.
             */
            if (
              typeof window !== "undefined" &&
              "Notification" in window &&
              Notification.permission === "granted" &&
              document.visibilityState !== "visible"
            ) {
              const n = new Notification(neue.title, {
                ...(neue.body ? { body: neue.body } : {}),
                tag: neue.id,
              });
              n.onclick = () => {
                window.focus();
                if (neue.link) router.push(neue.link);
                n.close();
              };
            }
          },
        )
        .subscribe();
    })();

    return () => {
      abgebrochen = true;
      if (kanal) void supabase.removeChannel(kanal);
    };
  }, [router]);

  /* Klick daneben schliesst. */
  useEffect(() => {
    if (!offen) return;
    const zu = (e: MouseEvent) => {
      if (!huelle.current?.contains(e.target as Node)) setOffen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOffen(false);
    };
    document.addEventListener("mousedown", zu);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", zu);
      document.removeEventListener("keydown", esc);
    };
  }, [offen]);

  function umschalten() {
    const neu = !offen;
    setOffen(neu);
    if (neu && liste === null) void laden();
  }

  async function alsGelesen(id: string) {
    setListe(
      (alt) =>
        alt?.map((m) =>
          m.id === id ? { ...m, read_at: new Date().toISOString() } : m,
        ) ?? alt,
    );
    setUngelesen((n) => Math.max(0, n - 1));
    const supabase = createClient();
    await supabase
      .from("notification")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
  }

  async function alleGelesen() {
    const jetzt = new Date().toISOString();
    const offene = (liste ?? []).filter((m) => !m.read_at).map((m) => m.id);
    setListe((alt) => alt?.map((m) => ({ ...m, read_at: m.read_at ?? jetzt })) ?? alt);
    setUngelesen(0);
    if (offene.length === 0) return;
    const supabase = createClient();
    await supabase.from("notification").update({ read_at: jetzt }).in("id", offene);
  }

  async function erlauben() {
    if (!("Notification" in window)) return;
    const antwort = await Notification.requestPermission();
    setErlaubnis(antwort);
    if (antwort === "granted") {
      /*
       * Eine Probe direkt nach dem Erlauben. Ohne sie weiss niemand, ob
       * es wirklich funktioniert — und beim nächsten echten Hinweis ist
       * der Browser womöglich im Vordergrund, dann kommt bewusst keine.
       */
      new Notification("Benachrichtigungen sind aktiv", {
        body: "Ab jetzt meldet sich der Browser, wenn etwas hereinkommt und das Fenster nicht im Vordergrund ist.",
      });
    }
  }

  return (
    <div ref={huelle} className="relative hidden sm:block">
      <button
        type="button"
        onClick={umschalten}
        aria-expanded={offen}
        aria-label={
          ungelesen > 0 ? `${ungelesen} ungelesene Hinweise` : "Keine neuen Hinweise"
        }
        className="relative flex h-[42px] w-[42px] cursor-pointer items-center justify-center rounded-pill border-0 bg-panel text-muted transition-colors duration-200 hover:text-ink"
      >
        <Icon name="glocke" size={18} />
        {ungelesen > 0 ? (
          <span className="absolute top-[6px] right-[6px] h-2 w-2 rounded-pill bg-s-crit" />
        ) : null}
      </button>

      {offen ? (
        <div className="absolute top-[52px] right-0 z-50 w-[360px] overflow-hidden rounded-card bg-surface shadow-soft">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-[13px]">
            <span className="text-[13.5px] font-semibold">
              Mitteilungen
              {ungelesen > 0 ? (
                <span className="num ml-[6px] text-[11.5px] text-s-crit">
                  {ungelesen} neu
                </span>
              ) : null}
            </span>
            {ungelesen > 0 ? (
              <button
                type="button"
                onClick={() => void alleGelesen()}
                className="cursor-pointer text-[12px] font-medium text-muted hover:text-ink hover:underline"
              >
                Alle gelesen
              </button>
            ) : null}
          </div>

          <ul className="max-h-[380px] overflow-y-auto">
            {liste === null ? (
              <li className="px-4 py-5 text-[13px] text-muted">Wird geladen …</li>
            ) : liste.length === 0 ? (
              <li className="px-4 py-5 text-[13px] text-muted">
                Nichts Neues. Hier landen Hinweise zu Lagerbestand, Nachweisen,
                Mahnungen und Antworten aus dem Kundenportal.
              </li>
            ) : (
              liste.map((m) => (
                <li key={m.id} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (!m.read_at) void alsGelesen(m.id);
                      if (m.link) {
                        setOffen(false);
                        router.push(m.link);
                      }
                    }}
                    className="flex w-full cursor-pointer items-start gap-[10px] px-4 py-[11px] text-left transition-colors duration-200 hover:bg-sunk"
                  >
                    <span
                      aria-hidden
                      className={[
                        "mt-[6px] h-[7px] w-[7px] shrink-0 rounded-pill",
                        m.read_at ? "bg-line" : "bg-s-crit",
                      ].join(" ")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-[1.4] font-semibold">
                        {m.title}
                      </span>
                      {/*
                        Der Text ist auf zwei Zeilen begrenzt. Ein Hinweis,
                        der eine halbe Spalte füllt, drückt die drei
                        darunter aus dem Blick — und genau die sind meist
                        die neueren.
                      */}
                      {m.body ? (
                        <span className="mt-[2px] line-clamp-2 text-[12.5px] leading-[1.45] text-muted">
                          {m.body}
                        </span>
                      ) : null}
                      <span className="num mt-[3px] block text-[11px] text-faint">
                        {wannText(m.created_at)}
                        {m.read_at ? "" : " · ungelesen"}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {erlaubnis && erlaubnis !== "granted" ? (
            <div className="border-t border-line px-4 py-[13px]">
              {erlaubnis === "denied" ? (
                <p className="text-[12px] leading-[1.5] text-muted">
                  Benachrichtigungen sind für diese Seite im Browser blockiert.
                  Das lässt sich nur dort wieder freigeben, im Schloss-Symbol
                  neben der Adresse.
                </p>
              ) : (
                <>
                  <p className="mb-[9px] text-[12px] leading-[1.5] text-muted">
                    Der Browser kann sich melden, wenn etwas hereinkommt und
                    dieses Fenster nicht im Vordergrund ist.
                  </p>
                  <button
                    type="button"
                    onClick={() => void erlauben()}
                    className="cursor-pointer rounded-pill bg-sunk px-[14px] py-[8px] text-[12.5px] font-semibold text-ink hover:bg-line"
                  >
                    Im Browser benachrichtigen
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
