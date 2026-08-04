"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { startseite } from "@/lib/nav";
import { T } from "@/lib/strings";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  weiter: z.string().startsWith("/").optional(),
});

export type LoginState = { error: string | null };

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    weiter: formData.get("weiter") || undefined,
  });

  if (!parsed.success) {
    return { error: T.login.failed };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Kein Hinweis darauf, ob die Adresse existiert — sonst ist das Formular
    // ein Verzeichnis aller Nutzerkonten.
    if (error.status === 429) return { error: T.login.rateLimited };
    return { error: T.login.failed };
  }

  revalidatePath("/", "layout");

  /*
   * Wohin es geht, entscheidet die Rolle: Montage und Lager landen in
   * ihrer eigenen App, das Büro im Cockpit. Ein Monteur, der auf einem
   * Board mit Auftragswerten landet, sucht erst einmal den Ausgang.
   */
  const { data: user } = await supabase.auth.getUser();
  const rolle =
    (user.user?.app_metadata as { role?: string } | undefined)?.role ?? "";

  // Nur interne Ziele, sonst ist "?weiter=" eine offene Weiterleitung.
  const target = parsed.data.weiter;
  redirect(
    target && !target.startsWith("//") ? target : startseite(rolle),
  );
}
