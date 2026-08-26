-- Modulare Speicher: Bausteine zählen statt eine feste Grösse wählen.
--
-- Fronius Reserva und Reserva Pro werden nicht als fertiger Speicher
-- gekauft, sondern als Stapel: ein BMS mit Sockel, darauf zwei bis fünf
-- (Pro: drei bis acht) Module à 3,15 bzw. 3,98 kWh. Der Planer konnte
-- das nicht abbilden — er kannte je Speicher genau eine Kapazität, und
-- das BMS fiel aus der Stückliste, obwohl ohne es kein Modul lädt.
--
-- Zwei Spalten reichen dafür: die untere Stapelgrenze und der Artikel
-- des BMS. Modulgrösse und obere Grenze gab es schon.

alter table planer_speicher
  add column if not exists min_module int,
  add column if not exists bms_artikel_id uuid references article(id) on delete set null;

comment on column planer_speicher.min_module is
  'Kleinster bestellbarer Stapel. Null heisst: ab einem Modul.';
comment on column planer_speicher.bms_artikel_id is
  'Steuereinheit, die je Stapel einmal mitgeliefert wird.';
