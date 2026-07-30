import { Shell } from "@/components/app/Shell";
import { requireMe } from "@/lib/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireMe();
  return <Shell me={me}>{children}</Shell>;
}
