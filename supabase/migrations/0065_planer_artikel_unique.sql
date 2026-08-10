/*
 * Der Eindeutigkeitsindex aus 0064 taugte nicht für die Übernahme.
 *
 * Er war partiell (`where artikel_id is not null`). Postgres nimmt für
 * `on conflict (company_id, artikel_id)` aber nur einen vollständigen
 * Unique-Index — oder einen partiellen, dessen Bedingung mit angegeben
 * wird, und das kann PostgREST nicht. Die Übernahme lief deshalb
 * fehlerfrei durch die Auswertung und scheiterte still am Schreiben:
 * „there is no unique or exclusion constraint matching the ON CONFLICT
 * specification".
 *
 * Ohne `where` geht dasselbe: Postgres behandelt NULL-Werte in einem
 * Unique-Index standardmässig als verschieden. Handgepflegte Geräte
 * ohne Artikelbezug (artikel_id is null) dürfen also weiterhin beliebig
 * viele sein — nur ein und derselbe Artikel ergibt je Mandant genau ein
 * Gerät.
 */

drop index if exists planer_modul_artikel;
drop index if exists planer_wr_artikel;
drop index if exists planer_speicher_artikel;

create unique index if not exists planer_modul_artikel
  on planer_modul (company_id, artikel_id);
create unique index if not exists planer_wr_artikel
  on planer_wechselrichter (company_id, artikel_id);
create unique index if not exists planer_speicher_artikel
  on planer_speicher (company_id, artikel_id);
