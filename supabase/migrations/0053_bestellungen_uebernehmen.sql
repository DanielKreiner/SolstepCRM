/*
 * Die alten Bestellungen in das neue Modell übernehmen.
 *
 * Bis hierher gab es zwei Bestellwege: purchase_order aus Meilenstein 4
 * (Bestellvorschlag aus Mindestbestand) und bestellung aus dem
 * Material-Briefing. Zwei Wege heissen zwei Wahrheiten darüber, was
 * unterwegs ist — und die Deckungsrechnung kennt nur einen davon.
 *
 * Deshalb wandert der Altbestand herüber und die alte Oberfläche
 * verschwindet. Die Tabellen bleiben vorerst stehen (CLAUDE.md 12.a,
 * zwei Schritte); sie werden erst gelöscht, wenn kein Code mehr auf sie
 * zeigt.
 *
 * Der Nummernkreis ist derselbe ('purchase_order'), die Nummern laufen
 * also lückenlos weiter.
 */

do $$
declare o record; b uuid;
begin
  for o in
    select id, company_id, supplier_id, number, status, due_date, sent_at, created_at
      from purchase_order
     where not exists (
       select 1 from bestellung x
        where x.company_id = purchase_order.company_id
          and x.nummer = purchase_order.number
     )
  loop
    insert into bestellung (
      company_id, nummer, lieferant_id, status, ziel, wunschtermin,
      bestellt_am, notiz, created_at
    ) values (
      o.company_id, o.number, o.supplier_id,
      case o.status
        when 'draft' then 'entwurf'
        when 'received' then 'geliefert'
        else 'bestellt'
      end,
      'hauptlager', o.due_date, o.sent_at,
      'Aus dem alten Bestellwesen übernommen', o.created_at
    )
    returning id into b;

    insert into bestellposition (
      company_id, bestellung_id, artikel_id, bezeichnung, menge, einheit,
      ek_netto, gelieferte_menge, sort
    )
    select o.company_id, b, i.article_id,
           coalesce(a.name, 'Artikel'), i.qty, coalesce(a.unit, 'Stk'),
           i.price, coalesce(i.received_qty, 0), row_number() over (order by i.id) * 10
      from purchase_order_item i
      left join article a on a.id = i.article_id
     where i.purchase_order_id = o.id;
  end loop;
end $$;

/*
 * Teilgeliefert ist im alten Modell kein eigener Status gewesen — er
 * ergibt sich hier erst aus den Mengen.
 */
update bestellung b
   set status = 'teilgeliefert'
 where b.status = 'bestellt'
   and exists (
     select 1 from bestellposition p
      where p.bestellung_id = b.id and p.gelieferte_menge > 0
   )
   and exists (
     select 1 from bestellposition p
      where p.bestellung_id = b.id
        and not p.storniert
        and p.gelieferte_menge < p.menge
   );
