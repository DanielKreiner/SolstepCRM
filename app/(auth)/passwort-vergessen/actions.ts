"use server";

import { z } from "zod";
import { passwortVergessen } from "@/lib/onboarding/zugang";

export type VergessenState = { fertig: boolean };

/**
 * Antwortet immer gleich.
 *
 * Weder ein Fehler noch eine abweichende Laufzeit darf verraten, ob es
 * zu der Adresse einen Zugang gibt. Deshalb gibt es hier keinen
 * Fehlerzustand: eine ungültige Eingabe führt zur selben Bestätigung wie
 * eine gültige, und was danach passiert, entscheidet der Server.
 */
export async function linkAnfordern(
  _prev: VergessenState,
  formData: FormData,
): Promise<VergessenState> {
  const email = z
    .string()
    .trim()
    .email()
    .safeParse(formData.get("email"));

  if (email.success) {
    await passwortVergessen(email.data);
  }

  return { fertig: true };
}
