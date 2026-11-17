/*
 * Der Katalog der Qualifikationen und Nachweise.
 *
 * `qualifikation` hält, was ein Betrieb an Fähigkeiten und Nachweisen
 * führt — angelegt beim Onboarding, danach nie wieder änderbar. Es gab
 * keine Oberfläche dafür, und damit blieb jeder Betrieb bei den vier
 * Einträgen aus dem Seed stehen. Sagt ein Betrieb "wir führen auch die
 * Gasunterweisung", ging das bisher gar nicht.
 *
 * Die Einträge haben zwei verschiedene Aufgaben, und bisher sah man
 * ihnen das nicht an:
 *
 *   FÄHIGKEIT — was jemand kann. Die Einsatzplanung gleicht sie gegen
 *   die benötigten Qualifikationen eines Einsatzes ab. "Elektrofachkraft",
 *   "Höhenarbeit". Sie läuft nicht ab.
 *
 *   NACHWEIS — ein Zertifikat mit Ablaufdatum, das überwacht wird.
 *   "Erste Hilfe 16 h", "Hubarbeitsbühne", "Unterweisung §5 ETV". Läuft
 *   er ab, steht der Mitarbeiter im Cockpit unter Handlungsbedarf, und
 *   ohne gültigen Nachweis darf niemand aufs Dach.
 *
 * Vieles ist beides — ein Staplerschein ist eine Fähigkeit UND ein
 * Nachweis mit Ablauf. Deshalb ein Kennzeichen und keine zweite
 * Tabelle: `nachweis` sagt nur, ob der Eintrag bei einem Mitarbeiter
 * ein Ablaufdatum bekommt.
 */

alter table qualifikation
  add column if not exists nachweis boolean not null default false;

comment on column qualifikation.nachweis is
  'true = der Eintrag ist ein Zertifikat mit Ablaufdatum und wird am '
  'Mitarbeiter überwacht. false = reine Fähigkeit für die '
  'Einsatzplanung. Vieles ist beides — dann true (0077).';

comment on table qualifikation is
  'Katalog der Fähigkeiten und Nachweise je Mandant. Die Einsatzplanung '
  'gleicht `app_user.qualifikationen` dagegen ab; Einträge mit '
  'nachweis = true stehen zusätzlich als Vorschlag im Nachweisformular '
  'am Mitarbeiter.';

/*
 * Die vier Einträge aus dem Seed sind Fähigkeiten; der Staplerschein
 * läuft ab. Ein bestehender Mandant soll nicht bei null anfangen
 * müssen, nur weil die Spalte neu ist.
 */
update qualifikation set nachweis = true where schluessel = 'stapler';

/*
 * Schreibrechte. Die generische Policy aus 0001 erlaubt der Firma
 * ohnehin alles; hier wird nur enger gefasst, wer schreiben darf —
 * der Katalog steuert, wer auf ein Dach darf, und gehört damit in
 * dieselbe Hand wie die übrigen Einstellungen.
 */
drop policy if exists qualifikation_ins on qualifikation;
drop policy if exists qualifikation_upd on qualifikation;
drop policy if exists qualifikation_del on qualifikation;

create policy qualifikation_ins on qualifikation
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and public.can('einstellungen', 'write')
  );

create policy qualifikation_upd on qualifikation
  for update to authenticated
  using (company_id = public.current_company_id() and public.can('einstellungen', 'write'))
  with check (company_id = public.current_company_id() and public.tenant_writable());

create policy qualifikation_del on qualifikation
  for delete to authenticated
  using (
    company_id = public.current_company_id()
    and public.tenant_writable()
    and public.can('einstellungen', 'write')
  );
