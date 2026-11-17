"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { T } from "@/lib/strings";
import { linkAnfordern, type VergessenState } from "./actions";

const INITIAL: VergessenState = { fertig: false };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" block disabled={pending}>
      {pending ? T.zugang.vergessenLaeuft : T.zugang.vergessenSubmit}
    </Button>
  );
}

export function VergessenForm({ email }: { email: string }) {
  const [state, formAction] = useActionState(linkAnfordern, INITIAL);

  if (state.fertig) {
    return (
      <div className="flex flex-col gap-[18px]">
        <p className="rounded-input bg-s-done/10 px-[13px] py-[11px] text-[13px] leading-[1.5] font-medium text-s-done">
          {T.zugang.vergessenFertig}
        </p>
        <Link
          href="/login"
          className="text-[13px] font-semibold text-accent hover:underline"
        >
          {T.zugang.zurueck}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-[15px]">
      <Field
        label={T.login.email}
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={email}
        required
        autoFocus
        placeholder="name@betrieb.at"
      />

      <div className="pt-[3px]">
        <Submit />
      </div>

      <Link
        href="/login"
        className="text-center text-[12.5px] font-medium text-muted hover:underline"
      >
        {T.zugang.zurueck}
      </Link>
    </form>
  );
}
