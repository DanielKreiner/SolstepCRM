-- =====================================================================
-- 0014 — Ein Lieferant, ein Artikel, ein Preis
--
-- article_supplier hatte keinen eindeutigen Schlüssel auf
-- (article_id, supplier_id). Damit liessen sich für dieselbe Kombination
-- beliebig viele Preiszeilen anlegen, und der Bestellvorschlag hätte je
-- nach Lesereihenfolge einen anderen Preis genommen — nicht falsch im
-- Sinne der Datenbank, aber nicht reproduzierbar.
--
-- Fachlich gibt es genau einen aktuellen Preis je Lieferant und Artikel.
-- Staffelpreise wären eine eigene Tabelle mit Mengenstufe; die gibt es
-- nicht und sie ist auch nicht vorgesehen.
--
-- Vor dem Index werden Dubletten zusammengeführt: die zuletzt angelegte
-- Zeile gewinnt, weil sie den jüngsten Preis trägt.
-- =====================================================================

delete from article_supplier a
using article_supplier b
where a.article_id = b.article_id
  and a.supplier_id = b.supplier_id
  and a.ctid < b.ctid;

alter table article_supplier
  add constraint article_supplier_artikel_lieferant_uniq
  unique (article_id, supplier_id);
