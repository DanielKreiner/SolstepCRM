-- =====================================================================
-- 0005 — stock_move ist ein Journal, kein Bearbeitungsformular
--
-- Zwei Löcher in der Bestandsführung:
--
-- 1. apply_stock_move feuert nur bei INSERT. Wird eine Bewegung gelöscht,
--    bleibt ihre Wirkung auf article.stock stehen. Der Bestand driftet
--    lautlos von der Summe seiner Bewegungen weg — und genau das ist der
--    Wert, gegen den später inventiert wird.
--
-- 2. Die generischen RLS-Policies erlauben authenticated ein DELETE auf
--    stock_move. Ein Lagerist konnte damit eine Entnahme spurlos entfernen.
--    Ein Warenbewegungsjournal wird nicht korrigiert, indem man Zeilen
--    entfernt, sondern durch eine Gegenbuchung (kind = 'correction').
--
-- Beides wird hier geschlossen. Der Reversal-Trigger bleibt trotzdem
-- bestehen: der Service-Role-Client (Seed, Tests, Mandanten-Löschung)
-- kann weiterhin löschen, und dann muss der Bestand mitgehen.
-- =====================================================================

create or replace function public.revert_stock_move() returns trigger
language plpgsql as $$
begin
  update article set stock = stock - case
    when old.kind = 'out' then -abs(old.qty)
    when old.kind in ('return','goods_in') then abs(old.qty)
    else old.qty end
  where id = old.article_id;
  return old;
end $$;

create trigger stock_move_revert after delete on stock_move
  for each row execute function public.revert_stock_move();

-- UPDATE ist genauso wenig vorgesehen: eine gebuchte Menge ändert sich nicht
-- nachträglich. Ohne diese Sperre müsste der Trigger die Differenz nachziehen,
-- und die Historie wäre trotzdem verfälscht.
revoke delete, update on stock_move from authenticated;

comment on table stock_move is
  'Warenbewegungsjournal. Nur INSERT durch die Anwendung. Korrekturen laufen '
  'über eine Gegenbuchung mit kind = ''correction'', nicht über UPDATE/DELETE.';
