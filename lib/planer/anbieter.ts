/*
 * Die vier Bildquellen des Planers.
 *
 * Geteilt zwischen Server und Client, deshalb steht hier KEIN Schlüssel.
 * Der Client erfährt nur, welcher Anbieter eingerichtet ist; die Kacheln
 * holt er über `/api/planer/kachel/...`, das den Schlüssel serverseitig
 * einsetzt. Läge der Schlüssel im Browser, könnte ihn jeder aus dem
 * Netzwerk-Tab ziehen und auf Kosten des Betriebs abrufen.
 *
 * Ausnahme basemap.at: frei, ohne Schlüssel, direkt aus dem Browser —
 * ein Proxy würde die Kacheln nur langsamer machen.
 */

export type AnbieterId = "basemap" | "google" | "azure" | "apple";

/**
 * Wie das Bild auf den Schirm kommt.
 *
 * `kachel` — Web-Mercator-Kacheln, die unsere eigene Engine platziert.
 * `sdk`    — der Anbieter gibt nur eine JS-Bibliothek heraus, keine
 *            einzeln adressierbaren Kacheln. Das trifft auf Apple zu:
 *            MapKit JS rendert selbst, es gibt keinen offenen
 *            Kachel-Endpunkt. Ein solcher Anbieter braucht eine eigene
 *            Bildschicht unter dem Canvas — siehe Hinweis unten.
 */
export type AnbieterArt = "kachel" | "sdk";

export interface Anbieter {
  id: AnbieterId;
  label: string;
  art: AnbieterArt;
  /** Höchste Stufe, die der Anbieter wirklich ausliefert. Darüber wird hochskaliert. */
  maxStufe: number;
  /** Braucht einen Schlüssel bzw. Token aus den Einstellungen. */
  brauchtSchluessel: boolean;
  /** Pflichtangabe im Bild, wo der Anbieter sie verlangt. */
  quelle: string;
}

export const ANBIETER: Anbieter[] = [
  {
    /*
     * Zuerst in der Leiste und Standard: läuft ohne Schlüssel, ist in
     * Österreich die schärfste Quelle und damit das, was der Monteur
     * beim Kunden am Tisch tatsächlich sieht.
     */
    id: "basemap",
    label: "Basemap",
    art: "kachel",
    // Geprüft: bmaporthofoto30cm liefert bis Stufe 19, ab 20 kommt 404.
    maxStufe: 19,
    brauchtSchluessel: false,
    quelle: "basemap.at",
  },
  {
    id: "google",
    label: "Google",
    art: "kachel",
    maxStufe: 21,
    brauchtSchluessel: true,
    quelle: "Google",
  },
  {
    id: "azure",
    label: "Bing/Azure",
    art: "kachel",
    maxStufe: 19,
    brauchtSchluessel: true,
    quelle: "Microsoft Azure Maps",
  },
  {
    /*
     * Apple weicht ab: MapKit JS ist eine Bibliothek, kein Kachelserver.
     * Es gibt keinen dokumentierten Endpunkt, den unsere Engine ansteuern
     * könnte, und Apples Bedingungen verlangen die Bibliothek. Deshalb
     * `art: "sdk"` — der Anbieter braucht eine eigene Bildschicht unter
     * dem Canvas, die auf dieselbe Kamera synchronisiert wird. Solange
     * die fehlt, steht Apple ausgegraut in der Leiste, statt so zu tun,
     * als käme dort ein Bild.
     */
    id: "apple",
    label: "Apple",
    art: "sdk",
    maxStufe: 21,
    brauchtSchluessel: true,
    quelle: "Apple Maps",
  },
];

export const STANDARD_ANBIETER: AnbieterId = "basemap";

export function anbieter(id: string): Anbieter {
  return ANBIETER.find((a) => a.id === id) ?? ANBIETER[0]!;
}

/**
 * Wie weit sich beim gewählten Anbieter sinnvoll heranzoomen lässt.
 *
 * Eine Stufe über die letzte echte Kachelstufe hinaus, mehr nicht: Ab
 * dort wird eine 30-cm-Aufnahme nur noch vergrössert, und aus dem Dach
 * wird ein Farbbrei. Der Planer liess vorher bis Stufe 22,5 zu — auf
 * einem Meter Bildbreite lagen dann acht Bildpunkte des Luftbilds, und
 * die Kante, die man treffen wollte, war nicht mehr zu sehen.
 *
 * Genauer wird die Planung dadurch nicht: Gezeichnet wird im
 * Metersystem, nicht in Bildpunkten. Wer es genauer braucht, lädt ein
 * Drohnenfoto und kalibriert es.
 */
export function hoechsterZoom(id: AnbieterId): number {
  return anbieter(id).maxStufe + 2;
}

/**
 * Direkte Kachel-URL — nur für Anbieter ohne Schlüssel. Alle anderen
 * gehen über den Proxy, siehe `kachelUrl`.
 */
function basemapUrl(z: number, x: number, y: number): string {
  return `https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/${z}/${y}/${x}.jpeg`;
}

export function kachelUrl(id: AnbieterId, z: number, x: number, y: number): string {
  if (id === "basemap") return basemapUrl(z, x, y);
  return `/api/planer/kachel/${id}/${z}/${x}/${y}`;
}

/**
 * Was der Client über die Verfügbarkeit wissen muss. Bewusst nur ein
 * Wahrheitswert je Anbieter — nie der Schlüssel selbst.
 */
export interface AnbieterStand {
  id: AnbieterId;
  verfuegbar: boolean;
  /** Warum nicht verfügbar — wird als Tooltip gezeigt. */
  grund?: string;
}

export function stand(id: AnbieterId, schluesselDa: boolean): AnbieterStand {
  const a = anbieter(id);
  if (a.art === "sdk") {
    return {
      id,
      verfuegbar: false,
      grund: `${a.label} liefert keine einzelnen Kacheln, sondern nur eine eigene Kartenbibliothek. Die Bildschicht dafür ist noch nicht gebaut.`,
    };
  }
  if (a.brauchtSchluessel && !schluesselDa) {
    return { id, verfuegbar: false, grund: "Schlüssel in den Einstellungen hinterlegen." };
  }
  return { id, verfuegbar: true };
}
