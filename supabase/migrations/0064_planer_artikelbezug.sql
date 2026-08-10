/*
 * Verweis vom Planer-Gerät auf den Artikelstamm (Briefing 8.2).
 *
 * Damit weiss der Planer, welcher Lagerartikel hinter einem Modul oder
 * Wechselrichter steht — für die Übernahme der Datenblattwerte heute
 * und für die vorbefüllte Bedarfsliste bei der Übergabe an einen
 * Vorgang später.
 *
 * `on delete set null`: verschwindet der Artikel aus dem Lager, bleibt
 * die Auslegung gültig. Ein Planungsprojekt darf nicht kaputtgehen,
 * weil jemand einen Artikel aussortiert.
 */

alter table planer_modul
  add column if not exists artikel_id uuid references article(id) on delete set null;
alter table planer_wechselrichter
  add column if not exists artikel_id uuid references article(id) on delete set null;
alter table planer_speicher
  add column if not exists artikel_id uuid references article(id) on delete set null;

/*
 * Ein Artikel ergibt höchstens EIN Planer-Gerät je Mandant — sonst
 * legte jede Übernahme dieselben Geräte erneut an.
 */
create unique index if not exists planer_modul_artikel
  on planer_modul (company_id, artikel_id) where artikel_id is not null;
create unique index if not exists planer_wr_artikel
  on planer_wechselrichter (company_id, artikel_id) where artikel_id is not null;
create unique index if not exists planer_speicher_artikel
  on planer_speicher (company_id, artikel_id) where artikel_id is not null;
