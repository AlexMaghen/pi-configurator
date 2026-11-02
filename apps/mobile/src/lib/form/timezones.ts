/**
 * Fallback time zone choices for a `timezone` select field that arrives without options.
 *
 * The Pi fills in the system's full list in `settings.describe`, so normally the field has
 * options and this isn't used. It stays as a fallback for a device that doesn't: the app offers
 * the phone's own IANA list (Intl.supportedValuesOf, else the short list below) and also lets the
 * user type any zone name. The Pi validates the value on save.
 */

const COMMON_ZONES = [
  "UTC",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Atlantic/Reykjavik",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Sydney",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

/** The phone's IANA zone list, or a short built-in list. Always includes UTC. */
export function timezoneChoices(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let zones: string[] = [];
  try {
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const list = zones.length > 0 ? zones : COMMON_ZONES;
  return list.includes("UTC") ? list : ["UTC", ...list];
}

/** Loose shape check for a typed zone name ("Area/City", "UTC"). The Pi has the final say. */
export const looksLikeTimezone = (s: string): boolean => /^(UTC|GMT|[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+)$/.test(s);
