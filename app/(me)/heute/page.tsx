import { redirect } from "next/navigation";

/*
 * /heute im Selfservice ist der Monteur-Tagesblick. Auf dem Desktop wäre er
 * eine schmalere Kopie von /m/heute — statt zwei Ansichten zu pflegen, die
 * auseinanderlaufen, führt der Weg auf die Monteur-App.
 */
export default function HeuteSelfservice() {
  redirect("/m/heute");
}
