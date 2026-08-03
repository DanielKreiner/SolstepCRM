"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

export type StockState = { error: string | null; ok: string | null };

const schema = z.object({
  articleId: z.string().uuid("Artikel fehlt."),
  jobId: z.string().uuid().nullable(),
  qty: z.coerce.number().positive("Menge muss größer als 0 sein."),
  kind: z.enum(["out", "return", "goods_in", "correction"]),
  note: z.string().max(300).nullable(),
  clientUuid: z.string().uuid().nullable(),
});

/*
 * Materialbuchung.
 *
 * Der Bestand wird NICHT hier fortgeschrieben — das macht der Trigger
 * apply_stock_move in der Datenbank. Zwei Schreibwege auf article.stock
 * würden früher oder später auseinanderlaufen.
 *
 * client_uuid ist die Idempotenzklammer für die Offline-Queue der Monteur-App
 * (Meilenstein 5): dieselbe Buchung zweimal gesendet ergibt eine Zeile.
 */
export async function bookStockMove(
  _prev: StockState,
  formData: FormData,
): Promise<StockState> {
  const me = await requireMe();

  if (me.perms.lager !== "write") {
    return { error: "Keine Berechtigung für Lagerbuchungen.", ok: null };
  }

  const parsed = schema.safeParse({
    articleId: formData.get("articleId"),
    jobId: emptyToNull(formData.get("jobId")),
    qty: formData.get("qty"),
    kind: formData.get("kind"),
    note: emptyToNull(formData.get("note")),
    clientUuid: emptyToNull(formData.get("clientUuid")),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe unvollständig.", ok: null };
  }

  const { articleId, jobId, qty, kind, note, clientUuid } = parsed.data;
  const supabase = await createClient();

  // Entnahme über den Bestand hinaus ist ein Warnfall, kein Fehler: das
  // Material liegt oft schon auf der Baustelle, bevor es jemand bucht.
  let warnung = "";
  if (kind === "out") {
    const { data: article } = await supabase
      .from("article")
      .select("stock, name, unit")
      .eq("id", articleId)
      .maybeSingle();

    const stock = Number(article?.stock ?? 0);
    if (stock < qty) {
      warnung = ` Achtung: Bestand war ${stock} ${article?.unit ?? ""}, gebucht wurden ${qty}.`;
    }
  }

  const { error } = await supabase.from("stock_move").insert({
    company_id: me.companyId,
    article_id: articleId,
    vorgang_id: jobId,
    user_id: me.id,
    qty,
    kind,
    note,
    client_uuid: clientUuid ?? randomUUID(),
  });

  if (error) {
    if (error.code === "23505") {
      return { error: null, ok: "Buchung war bereits erfasst." };
    }
    return { error: `Buchung fehlgeschlagen: ${error.message}`, ok: null };
  }

  revalidatePath("/lager");
  revalidatePath(`/lager/${articleId}`);
  if (jobId) revalidatePath(`/vorgaenge/${jobId}`);

  const label =
    kind === "out"
      ? "Entnahme"
      : kind === "return"
        ? "Rückgabe"
        : kind === "goods_in"
          ? "Wareneingang"
          : "Korrektur";

  return { error: null, ok: `${label} gebucht.${warnung}` };
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}
