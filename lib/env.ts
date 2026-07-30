import { z } from "zod";

/*
 * Validierung an jeder Systemgrenze — die Umgebung ist eine davon.
 * Fehlt eine Pflichtvariable, soll der Prozess beim Start scheitern und nicht
 * spaeter mit "undefined is not a valid URL" im Request.
 *
 * Optionale Gruppen bleiben optional: die App muss ohne jede optionale
 * Integration vollstaendig lauffaehig sein (CLAUDE.md Abschnitt 3).
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

/*
 * Next ersetzt NEXT_PUBLIC_* zur Buildzeit nur bei woertlichem Zugriff.
 * process.env darf hier also nicht durchgereicht werden.
 */
const parsedPublic = publicSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

if (!parsedPublic.success) {
  throw new Error(
    `Umgebungsvariablen fehlen oder sind ungültig:\n${parsedPublic.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")}`,
  );
}

export const publicEnv = parsedPublic.data;

/**
 * Serverseitige Geheimnisse. Bewusst als Funktion, nicht als Konstante:
 * so wird nichts ausgewertet, wenn eine Client-Datei die Datei versehentlich zieht.
 */
export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() darf nicht im Browser aufgerufen werden.");
  }

  const schema = z.object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  });

  const parsed = schema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Server-Umgebungsvariablen fehlen:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }

  return parsed.data;
}
