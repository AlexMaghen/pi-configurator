/**
 * Checking a value the phone wants to save against its field, and preparing fields for the phone.
 *
 * The app uses `validateValue` to show errors before sending; the Pi runs its own Python copy and
 * is the authority. Both are tested against `test-vectors/value-cases.json`.
 */
import type { SettingGroup, SettingItem } from "./config";
import { WifiValue } from "./config";
import type { FormField } from "./device";

/** The reason a value was refused, or `undefined` when it's fine. Messages are shown to users. */
export function validateValue(field: FormField, value: unknown): string | undefined {
  if ("readOnly" in field && field.readOnly) return "This setting can't be changed";
  switch (field.type) {
    case "string": {
      if (typeof value !== "string") return "Must be text";
      if (field.minLength !== undefined && value.length < field.minLength) {
        return `Must be at least ${field.minLength} characters`;
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `Must be at most ${field.maxLength} characters`;
      }
      if (field.pattern !== undefined && !new RegExp(field.pattern).test(value)) return "Not in the expected format";
      if (field.format === "url" && value !== "" && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value)) {
        return "Must be a URL";
      }
      if (field.format === "email" && value !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        return "Must be an email address";
      }
      return undefined;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Must be a number";
      if (field.type === "integer" && !Number.isInteger(value)) return "Must be a whole number";
      if (field.min !== undefined && value < field.min) return `Must be at least ${field.min}`;
      if (field.max !== undefined && value > field.max) return `Must be at most ${field.max}`;
      if (field.step !== undefined) {
        const steps = (value - (field.min ?? 0)) / field.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-9) return `Must be in steps of ${field.step}`;
      }
      return undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? undefined : "Must be on or off";
    case "select": {
      if (typeof value !== "string") return "Must be one of the choices";
      // The time zone field may come without options; the Pi checks it against its own list.
      if (field.options.length > 0 && !field.options.some((o) => o.value === value)) return "Must be one of the choices";
      return undefined;
    }
    case "wifi": {
      const parsed = WifiValue.safeParse(value);
      return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? "Not a valid Wi-Fi network");
    }
  }
}

/** An item as sent by `settings.describe`: a secret item's default is removed. */
export function describeItem(item: SettingItem): SettingItem {
  if (item.type === "string" && item.secret && item.default !== undefined) {
    const { default: _hidden, ...rest } = item;
    return rest;
  }
  return item;
}

/** The config's `appSettings` as sent by `settings.describe`. */
export const describeGroups = (groups: SettingGroup[] | undefined): SettingGroup[] =>
  (groups ?? []).map((g) => ({ ...g, items: g.items.map(describeItem) }));

/** Whether a field's value is hidden from the phone. */
export const isSecret = (field: FormField): boolean => field.type === "string" && field.secret === true;
