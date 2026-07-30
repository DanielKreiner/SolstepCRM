-- =====================================================================
-- seed.sql — Demomandant + zweiter Mandant für den RLS-Isolationstest
--
-- Ausführen:  pnpm exec supabase db push --include-seed   (verknüpftes Projekt)
--             pnpm exec supabase db reset                 (lokal, braucht Docker)
--
-- Der zweite Mandant ist keine Zierde: ohne ihn prüft der Isolationstest
-- nichts. "Mandant A sieht keine Zeilen" ist wertlos, wenn es keine
-- fremden Zeilen gibt, die er nicht sehen dürfte.
--
-- Auth-Nutzer legt scripts/seed-users.ts über die Admin-API an — app_metadata
-- ist aus SQL heraus nicht sauber setzbar.
-- =====================================================================

begin;

-- Feste UUIDs, damit scripts/seed-users.ts und die Tests darauf zeigen können.
-- A = Demomandant, B = Fremdmandant.
delete from company where id in (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

insert into company (id, name, uid_nr, address, zip, city, country, iban, status, plan, seats, trial_ends_at, onboarded_at)
values
  ('11111111-1111-4111-8111-111111111111', 'Hofstätter Energietechnik GmbH', 'ATU12345678',
   'Gewerbepark 14', '4020', 'Linz', 'AT', 'AT02 3456 7890 1234 5678', 'active', 'profi', 14,
   null, now()),
  ('22222222-2222-4222-8222-222222222222', 'Zweitbetrieb Solar GmbH', 'ATU87654321',
   'Industriestraße 3', '8020', 'Graz', 'AT', 'AT91 1000 0000 1234 5678', 'active', 'basis', 5,
   null, now());

-- ------------------------------------------------------------- STANDORTE
insert into location (id, company_id, name, address, zip, city, holiday_region, min_staffing)
values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Linz', 'Gewerbepark 14', '4020', 'Linz', 'AT-4', 4),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Wels', 'Handwerkerstraße 8', '4600', 'Wels', 'AT-4', 3),
  ('2a000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'Graz', 'Industriestraße 3', '8020', 'Graz', 'AT-6', 4);

-- ---------------------------------------------------------- ROLLENMATRIX
-- Wirkt serverseitig über public.can(). Das UI blendet nur zusätzlich aus.
insert into role_permission (company_id, role, area, level)
select c.id, r.role, a.area,
  case
    when r.role = 'gf' then 'write'::perm_level

    when r.role = 'buero' and a.area in
      ('pipelines','angebote','crm','rechnungen','zeiterfassung') then 'write'
    when r.role = 'buero' and a.area in ('lager','mitarbeiter','berichte') then 'read'

    when r.role = 'bauleitung' and a.area in ('pipelines','zeiterfassung') then 'write'
    when r.role = 'bauleitung' and a.area in ('angebote','crm','lager','berichte') then 'read'

    when r.role = 'monteur' and a.area = 'zeiterfassung' then 'write'
    when r.role = 'monteur' and a.area = 'pipelines' then 'read'

    when r.role = 'lager' and a.area = 'lager' then 'write'
    when r.role = 'lager' and a.area = 'pipelines' then 'read'

    else 'none'::perm_level
  end
from company c
cross join (select unnest(enum_range(null::user_role)) as role) r
cross join (values ('pipelines'),('angebote'),('crm'),('lager'),('rechnungen'),
                   ('zeiterfassung'),('mitarbeiter'),('berichte'),('einstellungen')) a(area)
where c.id in ('11111111-1111-4111-8111-111111111111',
               '22222222-2222-4222-8222-222222222222');

-- ------------------------------------------------------- STANDARDPHASEN
select public.seed_pipelines('11111111-1111-4111-8111-111111111111');
select public.seed_pipelines('22222222-2222-4222-8222-222222222222');

-- --------------------------------------------------------------- KUNDEN
insert into customer (id, company_id, type, number, name, contact_person, email, phone,
                      address, zip, city, source, crm_pipeline, crm_stage)
values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'customer', 'K-00101', 'Familie Brandstätter', 'Eva Brandstätter',
   'eva.brandstaetter@example.at', '+43 660 1234501',
   'Ahornweg 12', '4030', 'Linz', 'empfehlung', 'bestandskunden', null),
  ('c1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'customer', 'K-00102', 'Tischlerei Aigner GmbH', 'Markus Aigner',
   'office@aigner-tischlerei.at', '+43 732 998877',
   'Gewerbestraße 22', '4600', 'Wels', 'website', 'bestandskunden', null),
  ('c1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'lead', null, 'Landwirtschaft Grubmüller', 'Josef Grubmüller',
   'j.grubmueller@example.at', '+43 664 5566778',
   'Hofstraße 4', '4501', 'Neuhofen', 'messe', 'neukunden', 'qualifiziert'),
  -- Fremdmandant: existiert nur, damit der Isolationstest etwas zu finden hätte
  ('c2000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'customer', 'K-00001', 'Musterkunde Süd GmbH', 'Anna Berger',
   'a.berger@example.at', '+43 316 112233',
   'Südtiroler Platz 1', '8020', 'Graz', 'website', 'bestandskunden', null);

-- -------------------------------------------------------------- ARTIKEL
insert into article (company_id, sku, name, manufacturer, category, unit,
                     stock, min_stock, location_code, purchase_price, sale_price, vat_rate)
values
  ('11111111-1111-4111-8111-111111111111', 'MOD-JAS-440', 'JA Solar JAM54D40 440 W Bifazial',
   'JA Solar', 'Module', 'Stk', 312, 120, 'A-01', 78.40, 119.00, 20),
  ('11111111-1111-4111-8111-111111111111', 'WR-FRO-10', 'Fronius Symo GEN24 10.0 Plus',
   'Fronius', 'Wechselrichter', 'Stk', 11, 6, 'B-03', 1980.00, 2740.00, 20),
  ('11111111-1111-4111-8111-111111111111', 'SPE-BYD-10', 'BYD Battery-Box Premium HVS 10.2',
   'BYD', 'Speicher', 'Stk', 4, 3, 'B-07', 4120.00, 5490.00, 20),
  ('11111111-1111-4111-8111-111111111111', 'UK-K2-SD', 'K2 SpeedRail Schiene 3,30 m',
   'K2 Systems', 'Unterkonstruktion', 'Stk', 486, 200, 'C-02', 18.90, 29.50, 20),
  ('11111111-1111-4111-8111-111111111111', 'KAB-SOL-6', 'Solarkabel 6 mm² schwarz',
   'Helukabel', 'Kabel', 'm', 2400, 800, 'C-11', 0.92, 1.85, 20),
  ('22222222-2222-4222-8222-222222222222', 'MOD-XYZ-400', 'Fremdmodul 400 W',
   'Fremdhersteller', 'Module', 'Stk', 50, 20, 'A-01', 70.00, 110.00, 20)
on conflict (company_id, sku) do update set
  stock = excluded.stock,
  min_stock = excluded.min_stock,
  purchase_price = excluded.purchase_price,
  sale_price = excluded.sale_price;

-- -------------------------------------------------------------- AUFTRÄGE
-- phase_id kommt aus seed_pipelines(), die UUIDs stehen also nicht vorher fest.
-- Termine relativ zu heute, damit Cockpit und Einsatzplanung auch in einigen
-- Wochen noch etwas Sinnvolles zeigen.
insert into job (company_id, customer_id, location_id, number, phase_id,
                 planned_hours, value_net, material_planned,
                 address, zip, city, next_step, scheduled_from, scheduled_to)
select
  j.company_id, j.customer_id, j.location_id, j.number, ph.id,
  j.planned_hours, j.value_net, j.material_planned, j.address, j.zip, j.city, j.next_step,
  ((current_date + j.start_in) + time '07:00') at time zone 'Europe/Vienna',
  ((current_date + j.ende_in)  + time '16:00') at time zone 'Europe/Vienna'
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid,
   '1a000000-0000-4000-8000-000000000001'::uuid, 'A-2026-0041', 'montage',
   64.0, 28400.00, 16800.00, 'Ahornweg 12', '4030', 'Linz', 'Zählertausch mit Netz OÖ abstimmen',
   -2, 3),
  ('11111111-1111-4111-8111-111111111111'::uuid, 'c1000000-0000-4000-8000-000000000002'::uuid,
   '1a000000-0000-4000-8000-000000000002'::uuid, 'A-2026-0042', 'terminiert',
   112.0, 74900.00, 48200.00, 'Gewerbestraße 22', '4600', 'Wels', 'Gerüst für KW 34 fixieren',
   7, 18),
  ('11111111-1111-4111-8111-111111111111'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid,
   '1a000000-0000-4000-8000-000000000001'::uuid, 'A-2026-0038', 'abgenommen',
   38.0, 15200.00, 9100.00, 'Ahornweg 12', '4030', 'Linz', 'Schlussrechnung stellen',
   -12, -5),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'c2000000-0000-4000-8000-000000000001'::uuid,
   '2a000000-0000-4000-8000-000000000001'::uuid, 'A-2026-0001', 'montage',
   40.0, 19000.00, 11000.00, 'Südtiroler Platz 1', '8020', 'Graz', 'Fremdmandant, nur für den Isolationstest',
   -1, 4)
) as j(company_id, customer_id, location_id, number, phase_key,
       planned_hours, value_net, material_planned, address, zip, city, next_step,
       start_in, ende_in)
join pipeline p  on p.company_id = j.company_id and p.kind = 'projekte'
join pipeline_phase ph on ph.pipeline_id = p.id and ph.key = j.phase_key;

commit;
