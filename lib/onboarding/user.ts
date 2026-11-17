import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { zugangsLink, zugangsmail } from "./zugang";

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
   *
   * `zugangsLink` legt das Konto an und gibt den Anmeldelink zurück,
   * ohne eine Mail zu verschicken — die schreiben wir unten selbst.
   * Vorher stand hier `inviteUserByEmail`, und das verschickte
   * Supabases englische Standardvorlage mit einem Link auf die
   * Site-URL des Supabase-Projekts.
   */
  const link = await zugangsLink(admin, email, "invite", daten.name);

  if (!link.ok || !link.userId) {
    /*
     * Der häufigste Grund ist eine Adresse, die in auth.users noch
     * hängt, obwohl die zugehörige Zeile in app_user fort ist. Das
     * stillschweigend zu übernehmen wäre falsch — das Konto könnte zu
     * einem anderen Mandanten gehören.
     */
    return {
      ok: false,
      grund: `Konto konnte nicht angelegt werden: ${link.ok ? "kein Konto erhalten" : link.grund}`,
    };
  }

  const userId = link.userId;

  /*
   * app_metadata kommt unmittelbar danach: `generateLink` kennt es
   * nicht. Bis dahin hat der Nutzer keinen Mandanten und damit über RLS
   * auch keinen Zugriff — die Reihenfolge ist sicher herum. Die Mail mit
   * dem Link geht erst ganz am Ende raus, wenn alles steht.
   */
  const { error: zuordnung } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: appMetadata,
  });

  if (zuordnung) {
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, grund: `Zuordnung fehlgeschlagen: ${zuordnung.message}` };
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

  /*
   * Zuletzt die Mail. Scheitert sie, bleibt der Mitarbeiter angelegt —
   * er kommt dann über „Passwort vergessen" hinein, und der Aufrufer
   * sagt ihm das. Das Konto deswegen wieder zu löschen wäre der
   * schlechtere Tausch.
   */
  const einladung = await zugangsmail(admin, {
    companyId: daten.companyId,
    name: daten.name,
    email,
    art: "invite",
    url: link.url,
  });

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
