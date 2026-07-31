"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/session";

export type ChatState = { error: string | null; ok: string | null };

const sendSchema = z.object({
  channelId: z.string().uuid(),
  body: z.string().trim().min(1, "Leere Nachricht.").max(2000),
});

export async function sendMessage(
  _prev: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const me = await requireMe();

  const parsed = sendSchema.safeParse({
    channelId: formData.get("channelId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("chat_message").insert({
    company_id: me.companyId,
    channel_id: parsed.data.channelId,
    user_id: me.id,
    body: parsed.data.body,
  });

  if (error) return { error: `Senden fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/chat");
  return { error: null, ok: null };
}

const channelSchema = z.object({
  name: z.string().trim().min(2, "Name fehlt.").max(60),
  jobId: z.string().uuid().nullable(),
});

export async function createChannel(
  _prev: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const me = await requireMe();

  const parsed = channelSchema.safeParse({
    name: formData.get("name"),
    jobId: (formData.get("jobId") as string) || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Eingabe fehlt.", ok: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("chat_channel").insert({
    company_id: me.companyId,
    name: parsed.data.name,
    job_id: parsed.data.jobId,
    kind: parsed.data.jobId ? "job" : "team",
  });

  if (error) return { error: `Anlegen fehlgeschlagen: ${error.message}`, ok: null };

  revalidatePath("/chat");
  return { error: null, ok: `Kanal „${parsed.data.name}" angelegt.` };
}
