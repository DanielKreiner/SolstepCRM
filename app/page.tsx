import { redirect } from "next/navigation";

export default function Root() {
  // Die Middleware schickt ohne Session nach /login weiter.
  redirect("/cockpit");
}
