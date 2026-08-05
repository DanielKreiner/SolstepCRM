/*
 * Der Mindestbestands-Alarm meldete fast den ganzen Katalog.
 *
 * `v_stock_alert` prüfte `stock <= min_stock`. Bei 474 Artikeln stehen
 * 468 auf min_stock = 0 — und 0 <= 0 ist wahr. Damit galten 467 Artikel
 * als unter Mindestbestand, und das Abzeichen in der Navigation zeigte
 * eine Zahl, nach der niemand handeln kann. Eine Warnung, die immer
 * leuchtet, ist keine.
 *
 * Zwei Korrekturen:
 *
 * 1. Ein Mindestbestand von 0 heisst "keiner festgelegt", nicht "Alarm,
 *    sobald das Regal leer ist". Nur wer einen Mindestbestand gesetzt
 *    hat, will darüber gewarnt werden. Und die Grenze ist `<`, nicht
 *    `<=`: wer genau seinen Mindestbestand im Regal hat, hat ihn ja.
 *
 * 2. Der Bestand kommt aus `v_bestand`, nicht mehr aus `article.stock`.
 *    Seit 0051 entsteht der Bestand aus Lagerbewegungen; die alte Spalte
 *    wird nur noch von den Altwegen fortgeschrieben und weicht ab. Ein
 *    Alarm, der die falsche Zahl liest, ist schlimmer als keiner.
 *
 * `available` bleibt: es zieht offene Reservierungen ab, damit nicht
 * zweimal derselbe Karton verplant wird.
 */

/*
 * Drop statt replace: `bestand` schiebt sich zwischen die Spalten von
 * `article.*` und `available`, und das lässt `create or replace view`
 * nicht zu. Die Grants hängen an der View und fallen mit ihr — sie
 * stehen deshalb unten wieder da. (Nach 0009 die wiederkehrende Falle
 * dieses Schemas: ein Recht, das man nicht mitzieht, macht die Abfrage
 * nicht kaputt, sondern still leer.)
 */
drop view if exists v_stock_alert;

create view v_stock_alert as
select a.*,
       coalesce(b.menge, 0) as bestand,
       coalesce(b.menge, 0) - coalesce(
         (select sum(r.qty)
            from stock_reservation r
           where r.article_id = a.id and r.released_at is null), 0
       ) as available
  from article a
  left join (
    select artikel_id, sum(menge) as menge
      from v_bestand
     group by artikel_id
  ) b on b.artikel_id = a.id
 where a.active
   and a.min_stock > 0
   and coalesce(b.menge, 0) < a.min_stock;

alter view public.v_stock_alert set (security_invoker = on);

grant select on v_stock_alert to authenticated, anon, service_role;

comment on view v_stock_alert is
  'Artikel mit gesetztem Mindestbestand, deren Bestand darunter liegt. '
  'Bestand aus v_bestand (Lagerbewegungen), nicht aus article.stock.';
