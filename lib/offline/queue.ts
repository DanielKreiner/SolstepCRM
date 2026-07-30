"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/*
 * Offline-Warteschlange der Monteur-App.
 *
 * Jede schreibende Aktion geht ZUERST hierher und danach optimistisch ins UI
 * (CLAUDE.md Abschnitt 8). Erst wenn der Server bestätigt, verschwindet der
 * Eintrag. Ein Monteur auf einem Dach ohne Netz soll stempeln können, ohne
 * darüber nachzudenken.
 *
 * client_ts wird beim Erfassen gesetzt, nicht beim Senden — sonst wandern
 * alle Buchungen eines Tages auf den Zeitpunkt des Wiedereinbuchens.
 */

export type QueueKind = "time_start" | "time_stop" | "stock_move";

export type QueueItem = {
  id: string;
  kind: QueueKind;
  payload: Record<string, unknown>;
  clientTs: string;
  attempts: number;
  lastError?: string;
};

interface QueueDb extends DBSchema {
  queue: { key: string; value: QueueItem };
}

const DB_NAME = "betrieb-offline";
const STORE = "queue";

let dbPromise: Promise<IDBPDatabase<QueueDb>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<QueueDb>(DB_NAME, 1, {
      upgrade(database) {
        database.createObjectStore(STORE, { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function enqueue(
  kind: QueueKind,
  payload: Record<string, unknown>,
): Promise<QueueItem> {
  const item: QueueItem = {
    id: crypto.randomUUID(),
    kind,
    payload,
    clientTs: new Date().toISOString(),
    attempts: 0,
  };
  const database = await db();
  await database.put(STORE, item);
  return item;
}

export async function list(): Promise<QueueItem[]> {
  const database = await db();
  const items = await database.getAll(STORE);
  return items.sort((a, b) => a.clientTs.localeCompare(b.clientTs));
}

export async function remove(id: string): Promise<void> {
  const database = await db();
  await database.delete(STORE, id);
}

async function markFailed(item: QueueItem, error: string): Promise<void> {
  const database = await db();
  await database.put(STORE, {
    ...item,
    attempts: item.attempts + 1,
    lastError: error,
  });
}

export type FlushResult = { gesendet: number; offen: number; fehler: string[] };

/**
 * Warteschlange abarbeiten.
 *
 * Die id des Eintrags wandert als client_uuid mit — der Server verwirft
 * Doppelte über den Unique-Index. Ein Retry nach abgebrochener Verbindung
 * darf keine zweite Buchung erzeugen.
 */
export async function flush(): Promise<FlushResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const offen = (await list()).length;
    return { gesendet: 0, offen, fehler: [] };
  }

  const items = await list();
  let gesendet = 0;
  const fehler: string[] = [];

  for (const item of items) {
    try {
      const antwort = await fetch("/api/m/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientUuid: item.id,
          kind: item.kind,
          clientTs: item.clientTs,
          payload: item.payload,
        }),
      });

      if (antwort.ok) {
        await remove(item.id);
        gesendet++;
        continue;
      }

      const text = await antwort.text();
      // 4xx sind fachliche Ablehnungen — die werden nie erfolgreich, ein
      // ewiger Retry blockiert nur die restliche Warteschlange.
      if (antwort.status >= 400 && antwort.status < 500) {
        await remove(item.id);
        fehler.push(kurz(text));
      } else {
        await markFailed(item, kurz(text));
        fehler.push(kurz(text));
      }
    } catch (e) {
      await markFailed(item, e instanceof Error ? e.message : "Netzfehler");
      break; // Netz weg: der Rest wartet auf den nächsten Versuch.
    }
  }

  return { gesendet, offen: (await list()).length, fehler };
}

function kurz(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: string };
    return j.error ?? text.slice(0, 120);
  } catch {
    return text.slice(0, 120);
  }
}
