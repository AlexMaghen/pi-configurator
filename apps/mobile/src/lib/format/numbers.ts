/**
 * Number display and input. The owner's rule: numbers are shown with thousands separators
 * ("5,000"). Written out rather than relying on Intl, so output is the same on every engine.
 */

/** 5000 -> "5,000", -1234.5 -> "-1,234.5". Decimals are kept as JavaScript prints them. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const [whole = "0", fraction] = Math.abs(n).toString().split(".");
  if (whole.includes("e")) return n.toString(); // Very large or small: leave as is.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}

/**
 * Parses what a user typed, accepting thousands separators and spaces. Undefined if not a number.
 *
 * The iOS decimal pad shows a comma instead of a point in countries that write 2,5. So a single
 * comma with no point is read as a decimal comma, unless exactly three digits follow it
 * ("1,250" stays one thousand two hundred fifty, as the app itself writes it).
 */
export function parseNumber(text: string): number | undefined {
  let typed = text.trim();
  const decimalComma = /^[-+]?\d*,(\d{1,2}|\d{4,})$/;
  if (decimalComma.test(typed)) typed = typed.replace(",", ".");
  const clean = typed.replace(/[,\s_]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(clean)) return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
}

/** Signal strength in dBm (about -100 to -30) as 0..4 bars. */
export function rssiBars(rssi: number | undefined): number {
  if (rssi === undefined) return 0;
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  if (rssi >= -90) return 1;
  return 0;
}

/** Wi-Fi signal 0..100 % as 0..4 bars. */
export const percentBars = (signal: number | undefined): number =>
  signal === undefined ? 0 : Math.max(0, Math.min(4, Math.ceil(signal / 25)));

/** "12:04:31" in the phone's local time, for activity entries. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
