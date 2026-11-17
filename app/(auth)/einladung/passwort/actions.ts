"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { startseite } from "@/lib/nav";
import { T } from "@/lib/strings";

/*
 * Mindestens zehn Zeichen. Supabase lässt serverseitig weniger zu, aber
 * dieses Konto führt in Arbeitszeiten, Lohnkosten und Kundendaten — ein
 * sechsstelliges Passwort ist dafür zu wenig. Keine Regeln zu Zeichen-
 * arten: die erzeugen vorhersehbare Passwörter, keine besseren.
 */
const schema = z
  .object({
    passwort: z.string().min(10, T.zugang.zuKurz),
    wiederholung: z.string(),
  })
  .refine((d) => d.passwort === d.wiederholung, {
    message: T.zugang.ungleich,
    path: ["wiederholung"],
  });

export type ZugangState = { error: string | null };

export async function passwortSetzen(
  _prev: ZugangState,
  formData: FormData,
): Promise<ZugangState> {
  const parsed = schema.safeParse({
    passwort: formData.get("passwort"),
    wiederholung: formData.get("wiederholung"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? T.zugang.zuKurz };
  }

  const supabase = await createClient();

  /*
   * Die Sitzung stammt aus dem eingelösten Token. Besteht sie nicht
   * mehr — der Link war zu alt, oder zwischen Klick und Absenden lag zu
   * viel Zeit —, führt der Weg über eine neue Mail, nicht über eine
   * Fehlermeldung ohne Ausweg.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?hinweis=link");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.passwort,
  });

  if (error) {
    return { error: error.message || T.zugang.fehlgeschlagen };
  }

  revalidatePath("/", "layout");

  const rolle = (user.app_metadata as { role?: string } | undefined)?.role ?? "";
  redirect(startseite(rolle));
}
