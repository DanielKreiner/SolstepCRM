"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { T } from "@/lib/strings";
import { passwortSetzen, type ZugangState } from "./actions";

const INITIAL: ZugangState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" block disabled={pending}>
      {pending ? T.zugang.submitting : T.zugang.submit}
    </Button>
  );
}

export function PasswortForm({ email }: { email: string }) {
  const [state, formAction] = useActionState(passwortSetzen, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-[15px]">
      {/*
       * Die Adresse steht sichtbar und als verstecktes Feld da: sichtbar,
       * damit klar ist, für welchen Zugang das Passwort gilt, versteckt,
       * damit der Passwortspeicher des Browsers es dem richtigen Konto
       * zuordnet. Ohne das zweite legt Chrome einen Eintrag ohne
       * Benutzernamen an.
       */}
      <input
        type="email"
        name="email"
        value={email}
        autoComplete="username"
        readOnly
        hidden
      />

      <p className="num rounded-input bg-sunk px-[13px] py-[10px] text-[13px] text-muted">
        {email}
      </p>

      <Field
        label={T.zugang.passwort}
        name="passwort"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        autoFocus
      />
      <Field
        label={T.zugang.wiederholung}
        name="wiederholung"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />

      {state.error ? (
        <p
          role="alert"
          className="rounded-input bg-s-crit/10 px-[13px] py-[10px] text-[13px] font-medium text-s-crit"
        >
          {state.error}
        </p>
      ) : null}

      <div className="pt-[3px]">
        <Submit />
      </div>
    </form>
  );
}
