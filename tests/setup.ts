import { readFileSync } from "node:fs";

/*
 * .env.local einlesen, ohne dotenv als Abhängigkeit. In CI kommen die Werte
 * aus den Repository-Secrets, dann fehlt die Datei einfach.
 */
try {
  const file = readFileSync(".env.local", "utf8");
  for (const line of file.split("\n")) {
    if (!/^[A-Z_0-9]+=/.test(line)) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (process.env[key] !== undefined) continue;
    process.env[key] = line.slice(i + 1).replace(/^"|"$/g, "");
  }
} catch {
  // In CI erwartet, lokal nicht.
}
