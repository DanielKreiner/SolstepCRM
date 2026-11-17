"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { T } from "@/lib/strings";
import { signIn, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" block disabled={pending}>
      {pending ? T.login.submitting : T.login.submit}
    </Button>
  );
}

export function LoginForm({ weiter }: { weiter: string | undefined }) {
  const [state, formAction] = useActionState(signIn, INITIAL);

  /*
   * Die getippte Adresse wandert mit zur Anforderung eines neuen Links.
   * Wer sein Passwort nicht mehr weiss, hat die Mailadresse gerade
   * eingetippt — sie noch einmal zu verlangen ist eine Schikane.
   */
  const [email, setEmail] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-[15px]">
      {weiter ? <input type="hidden" name="weiter" value={weiter} /> : null}

      <Field
        label={T.login.email}
        name="email"
        type="email"
        autoComplete="username"
        required
        autoFocus
        placeholder="name@betrieb.at"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label={T.login.password}
        name="password"
        type="password"
        autoComplete="current-password"
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

      <Link
        href={
          email.includes("@")
            ? `/passwort-vergessen?email=${encodeURIComponent(email)}`
            : "/passwort-vergessen"
        }
        className="text-center text-[12.5px] font-medium text-muted hover:underline"
      >
        {T.login.forgot}
      </Link>
    </form>
  );
}
