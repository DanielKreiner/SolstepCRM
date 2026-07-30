import type { Metadata } from "next";
import { Placeholder } from "@/components/ui/Placeholder";
import { requireMe } from "@/lib/session";

export const metadata: Metadata = { title: "Chat" };

export default async function Page() {
  await requireMe();
  return <Placeholder title="Chat" milestone={11} scope="Teamkanäle und auftragsbezogene Kanäle." />;
}
