import { Shell } from "@/components/app/Shell";
import { requireMe } from "@/lib/session";

/*
 * Mitarbeiter-Selfservice.
 *
 * Derselbe Rahmen wie das Backoffice, aber die Seiten darin zeigen
 * ausschließlich die eigenen Daten. Das ist keine Anzeigeentscheidung: die
 * Rechte aus Migration 0008 lassen einem Monteur ohnehin nichts anderes
 * durch.
 */
export default async function MeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireMe();
  return <Shell me={me}>{children}</Shell>;
}
