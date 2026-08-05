import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ausJson, pausenabzug, runde } from "@/lib/rules/zeitregeln";

/**
 * Die Zeitregeln des Mandanten auf eine Spanne anwenden.
 *
 * Rundung und Pausenautomatik stehen in den Einstellungen und galten
 * bis hierher nirgends: jeder schreibende Weg rechnete `>= 360 ? 30 : 0`
 * für sich. Ein Betrieb, der auf 15 Minuten rundet, bekam keine Rundung,
 * und wer die Pause auf 45 Minuten ab 8 Stunden stellte, bekam trotzdem
 * 30 ab 6. Eine Einstellung ohne Wirkung ist schlimmer als keine.
 *
 * Gerundet wird das Ende, nie der Beginn — wann jemand angefangen hat,
 * ist eine Tatsache und keine Rechengrösse.
 */
export async function regelnAnwenden(
  supabase: SupabaseClient,
  companyId: string,
  von: string,
  bis: string,
  bereitsGebuchtePauseMin = 0,
): Promise<{ bis: string; dauerMin: number; autoBreakMin: number }> {
  const { data: firma } = await supabase
    .from("company")
    .select("time_settings")
    .eq("id", companyId)
    .maybeSingle();

  const regeln = ausJson(firma?.time_settings);
  const roh = Math.max(
    0,
    Math.round((new Date(bis).getTime() - new Date(von).getTime()) / 60_000),
  );

  const dauerMin = runde(roh, regeln);
  const { abzugMin } = pausenabzug(dauerMin, bereitsGebuchtePauseMin, regeln);

  return {
    bis: new Date(new Date(von).getTime() + dauerMin * 60_000).toISOString(),
    dauerMin,
    autoBreakMin: abzugMin,
  };
}
