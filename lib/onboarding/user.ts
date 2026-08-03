import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Einen Mitarbeiter anlegen und einladen.
 *
 * Das geht nur über die Supabase-Admin-API: ein Konto entsteht in
 * auth.users, und `company_id` und `role` müssen in `app_metadata`
 * stehen — nicht in `user_metadata`, denn das ist vom Client änderbar
 * und würde bedeuten, dass sich jeder Nutzer selbst zum Mandanten
 * seiner Wahl und zur Geschäftsführung machen kann (CLAUDE.md 4.2).
 *
 * Deshalb liegt das hier und nicht in einer Server Action: der
 * Service-Role-Client hat in `app/(app)` nichts zu suchen. Wer diese
 * Datei ändert, ändert eine Sicherheitsgrenze. Der Aufrufer muss vorher
 * geprüft haben, dass der handelnde Nutzer Schreibrecht auf
 * "mitarbeiter" hat und zum selben Mandanten gehört.
 */

export type NeuerNutzer = {
  companyId: string;
  name: string;
  email: string;
  role: string;
  locationId: string | null;
  phone: string | null;
  weeklyHours: number;
  employmentType: string;
  hourlyCost: number | null;
  vacationDaysYear: number;
};

export type AnlageErgebnis =
  | { ok: true; userId: string; einladung: boolean }
  | { ok: false; grund: string };

export async function mitarbeiterAnlegen(
  daten: NeuerNutzer,
): Promise<AnlageErgebnis> {
  const admin = createAdminClient();
  const email = daten.email.trim().toLowerCase();

  /*
   * Existiert die Adresse schon, wird sie nicht stillschweigend
   * übernommen. Sie könnte zu einem anderen Mandanten gehören — dann
   * würde ein Update der app_metadata diesen Nutzer aus seinem Betrieb
   * herausreissen.
   */
  const { data: bestand } = await admin
    .from("app_user")
    .select("id, company_id")
    .eq("email", email)
    .maybeSingle();

  if (bestand) {
    return {
      ok: false,
      grund:
        bestand.company_id === daten.companyId
          ? "Diese Adresse gehört bereits zu einem Mitarbeiter."
          : "Diese Adresse ist schon vergeben.",
    };
  }

  const appMetadata = { company_id: daten.companyId, role: daten.role };

  /*
   * Einladung per Mail statt Passwortvergabe durch das Büro. Ein
   * Passwort, das jemand anderes kennt und weitergibt, ist keins.
   * Schlägt der Mailversand fehl — etwa weil noch kein Postfach
   * eingehängt ist —, wird das Konto trotzdem angelegt und der Nutzer
   * kann sich über „Passwort vergessen" selbst hineinlassen.
   */
  const { data: eingeladen, error: einladungsFehler } =
    await admin.auth.admin.inviteUserByEmail(email, {
      data: { name: daten.name },
    });

  let userId = eingeladen?.user?.id ?? null;
  let einladung = Boolean(userId);

  if (!userId) {
    const { data: erzeugt, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: false,
      app_metadata: appMetadata,
      user_metadata: { name: daten.name },
    });
    if (error || !erzeugt.user) {
      return {
        ok: false,
        grund: `Konto konnte nicht angelegt werden: ${
          error?.message ?? einladungsFehler?.message ?? "unbekannt"
        }`,
      };
    }
    userId = erzeugt.user.id;
    einladung = false;
  } else {
    /*
     * inviteUserByEmail kennt kein app_metadata, deshalb kommt es
     * unmittelbar danach. Bis dahin hat der Nutzer keinen Mandanten und
     * damit über RLS auch keinen Zugriff — die Reihenfolge ist sicher
     * herum.
     */
    const { error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: appMetadata,
    });
    if (error) {
      return { ok: false, grund: `Zuordnung fehlgeschlagen: ${error.message}` };
    }
  }

  const { error: zeilenFehler } = await admin.from("app_user").insert({
    id: userId,
    company_id: daten.companyId,
    location_id: daten.locationId,
    name: daten.name,
    email,
    phone: daten.phone,
    role: daten.role,
    weekly_hours: daten.weeklyHours,
    employment_type: daten.employmentType,
    hourly_cost: daten.hourlyCost,
    vacation_days_year: daten.vacationDaysYear,
    active: true,
  });

  if (zeilenFehler) {
    /*
     * Ohne Zeile in app_user ist das Konto nutzlos und trotzdem
     * vorhanden — beim nächsten Versuch wäre die Adresse blockiert.
     * Also zurückrollen.
     */
    await admin.auth.admin.deleteUser(userId);
    return {
      ok: false,
      grund: `Mitarbeiter konnte nicht angelegt werden: ${zeilenFehler.message}`,
    };
  }

  return { ok: true, userId, einladung };
}

/**
 * Rolle in app_metadata nachziehen.
 *
 * app_user.role steuert die Anzeige, app_metadata.role steuert RLS. Wer
 * nur das eine ändert, gibt jemandem eine Rolle, die die Datenbank nicht
 * kennt — oder umgekehrt Rechte, die im UI nicht sichtbar sind.
 *
 * `companyId` wird mitgeprüft: die Rolle eines Nutzers aus einem anderen
 * Mandanten darf hier niemand setzen.
 */
export async function rolleSetzen(
  userId: string,
  companyId: string,
  role: string,
): Promise<{ ok: true } | { ok: false; grund: string }> {
  const admin = createAdminClient();

  const { data: nutzer } = await admin
    .from("app_user")
    .select("id")
    .eq("id", userId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!nutzer) return { ok: false, grund: "Mitarbeiter nicht gefunden." };

  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { company_id: companyId, role },
  });

  if (error) {
    return { ok: false, grund: `Rolle konnte nicht gesetzt werden: ${error.message}` };
  }
  return { ok: true };
}
