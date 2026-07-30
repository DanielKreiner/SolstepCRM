"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { receiveItem, sendPurchaseOrder, type OrderState } from "./actions";

const INITIAL: OrderState = { error: null, ok: null };

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="quiet" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

type Props =
  | { mode: "send"; orderId: string }
  | { mode: "receive"; orderId: string; itemId: string; defaultQty: number };

export function OrderActions(props: Props) {
  if (props.mode === "send") return <SendForm orderId={props.orderId} />;
  return (
    <ReceiveForm
      orderId={props.orderId}
      itemId={props.itemId}
      defaultQty={props.defaultQty}
    />
  );
}

function SendForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(sendPurchaseOrder, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <Submit label="An Lieferant senden" busy="Reiht ein …" />
      {state.error ? (
        <span role="alert" className="text-[12.5px] font-medium text-s-crit">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span role="status" className="text-[12.5px] font-medium text-s-done">
          {state.ok}
        </span>
      ) : null}
    </form>
  );
}

function ReceiveForm({
  orderId,
  itemId,
  defaultQty,
}: {
  orderId: string;
  itemId: string;
  defaultQty: number;
}) {
  const [state, formAction] = useActionState(receiveItem, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input
        type="number"
        name="qty"
        min="0.001"
        step="0.001"
        defaultValue={defaultQty}
        aria-label="Eingegangene Menge"
        className="num w-[86px] rounded-input border border-transparent bg-surface px-2 py-[6px] text-right text-[12.5px] outline-0 focus:border-accent"
      />
      <button
        type="submit"
        className="cursor-pointer rounded-pill bg-sunk px-[13px] py-[6px] text-[12.5px] font-medium text-ink transition-colors hover:bg-line"
      >
        Wareneingang
      </button>
      {state.error ? (
        <span role="alert" className="text-[12px] text-s-crit">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span role="status" className="text-[12px] text-s-done">
          {state.ok}
        </span>
      ) : null}
    </form>
  );
}
