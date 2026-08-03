-- Angebotssumme kommt aus den Positionen, nicht aus dem schreibenden Code.
--
-- Bisher hat jede Stelle, die Positionen anfasst, quote.net_total selbst
-- mitgeschrieben. Seit der Kunde im Portal eine optionale Erweiterung
-- dazubuchen kann, geht das nicht mehr auf: die Portalseite rechnet aus
-- den Positionen, das Backoffice liest net_total — und die beiden
-- driften auseinander, sobald jemand ein Häkchen setzt. Der Kunde bucht
-- eine Wallbox für 890 € dazu und im Auftrag steht der alte Wert.
--
-- Ab hier rechnet die Datenbank. Damit gibt es eine Summe, egal über
-- welchen Weg eine Position entsteht — Formular, Portal oder Import.
--
-- Was zählt:
--   position, paket, leistung  → immer
--   option                     → nur wenn der Kunde sie gewählt hat
--   paket_inhalt               → nie, das steckt schon im Paketpreis
--
-- Abwärtskompatibel im Sinn von 12.a: die Spalten bleiben, ihr Wert wird
-- nur nicht mehr von Hand gesetzt. Code, der weiterhin net_total
-- mitschreibt, wird vom Trigger überstimmt, aber nicht kaputt gemacht.

create or replace function public.quote_summe_neu(p_quote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update quote q
     set net_total = coalesce(s.netto, 0) + coalesce(q.delivery_net, 0),
         cost_total = coalesce(s.kosten, 0),
         updated_at = now()
    from (
      select
        sum(case when zaehlt then qty * sale_price else 0 end) as netto,
        sum(case when zaehlt then qty * purchase_price else 0 end) as kosten
      from (
        select
          qty, sale_price, purchase_price,
          case
            when kind = 'paket_inhalt' then false
            when kind = 'option' then optional_selected
            else true
          end as zaehlt
        from quote_item
        where quote_id = p_quote
      ) t
    ) s
   where q.id = p_quote;
end;
$$;

comment on function public.quote_summe_neu(uuid) is
  'Rechnet net_total und cost_total eines Angebots aus seinen Positionen neu.';

create or replace function public.quote_summe_trigger()
returns trigger
language plpgsql
as $$
begin
  perform public.quote_summe_neu(coalesce(new.quote_id, old.quote_id));
  return null;
end;
$$;

drop trigger if exists trg_quote_item_summe on quote_item;
create trigger trg_quote_item_summe
  after insert or update or delete on quote_item
  for each row execute function public.quote_summe_trigger();

-- Die Lieferpauschale steckt in der Summe, also muss ihre Änderung sie
-- ebenfalls neu rechnen. Nur bei tatsächlicher Änderung, sonst dreht sich
-- der Trigger im Kreis, weil quote_summe_neu selbst quote schreibt.
create or replace function public.quote_lieferung_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.delivery_net is distinct from old.delivery_net then
    perform public.quote_summe_neu(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_quote_lieferung_summe on quote;
create trigger trg_quote_lieferung_summe
  after update of delivery_net on quote
  for each row execute function public.quote_lieferung_trigger();

-- Bestand einmal geradeziehen. Angebote ohne Positionen bleiben, wie sie
-- sind — dort ist der von Hand gesetzte Betrag die einzige Information.
do $$
declare r record;
begin
  for r in
    select distinct quote_id from quote_item
  loop
    perform public.quote_summe_neu(r.quote_id);
  end loop;
end $$;
