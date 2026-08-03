-- Zeiterfassungsregeln je Mandant.
--
-- Die Arbeitszeitgrenzen (Ruhezeit, Höchstarbeitszeit) stehen bereits je
-- Standort in location.worktime_rules — das ist Arbeitsrecht und kann sich
-- zwischen zwei Niederlassungen unterscheiden.
--
-- Was hier dazukommt, ist etwas anderes: wie der Betrieb Zeiten erfasst
-- und abrechnet. Rundung, automatischer Pausenabzug und Zuschlagssätze
-- sind eine kaufmännische Konvention und gelten im ganzen Betrieb gleich,
-- deshalb an company und nicht an location.
--
-- Die Voreinstellung rundet nicht. Eine Software, die ab Werk Arbeitszeit
-- wegrundet, ohne dass es jemand entschieden hat, ist der falsche Anfang.

alter table company
  add column if not exists time_settings jsonb not null default '{
    "rundungMin": 0,
    "pauseAbMin": 360,
    "pauseAbzugMin": 30,
    "abendAb": "18:00",
    "nachtAb": "22:00",
    "nachtBis": "06:00",
    "zuschlagAbendPct": 25,
    "zuschlagNachtPct": 50,
    "zuschlagSamstagPct": 50,
    "zuschlagSonntagPct": 100,
    "zuschlagFeiertagPct": 100
  }'::jsonb;

comment on column company.time_settings is
  'Rundung, Pausenautomatik und Zuschlagssätze. Gelesen von '
  'lib/rules/zeitregeln.ts, das fehlende Werte aus dem Standard ergänzt.';

-- Nach 0009 gilt: ein Tabellen-GRANT deckt neue Spalten ab, ein
-- spaltenweiser nicht. company hat kein spaltenweises Leserecht, deshalb
-- ist hier nichts nachzuholen — geprüft, nicht angenommen.

-- Der automatische Pausenabzug darf die erfasste Zeit nicht überschreiben
-- (CLAUDE.md Abschnitt 5, Punkt 4: Zeitkorrekturen überschreiben nie).
-- Er wird beim Auswerten gerechnet. Damit man sieht, dass er gegriffen hat,
-- hält der Eintrag das Ergebnis fest — als Nachweis, nicht als Wahrheit.
alter table time_entry
  add column if not exists auto_break_min int not null default 0;

comment on column time_entry.auto_break_min is
  'Automatisch abgezogene Pausenminuten zum Zeitpunkt der Erfassung. '
  'Nachweis für den Mitarbeiter, welche Regel gegriffen hat. '
  'started_at und ended_at bleiben unangetastet.';
