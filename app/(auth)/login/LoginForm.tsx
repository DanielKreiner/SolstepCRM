"use client";

import { useActionState } from "react";
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
    </form>
  );
}
