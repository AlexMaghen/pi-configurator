/**
 * The settings form without React: grouping fields, turning what the user typed into values,
 * validating them with the shared `validateValue`, and working out which fields changed.
 *
 * A draft is what the user has done to one field and not saved yet:
 *   { kind: "text", text }    typed into a text or number input (parsed when needed)
 *   { kind: "value", value }  picked with a switch, picker or the Wi-Fi screen
 *   { kind: "reset" }         "Reset to default" on a store field (sent as null)
 * Fields without a draft are unchanged and are not sent.
 */
import {
  validateValue,
  type DescribedField,
  type SettingValue,
  type ValueState,
} from "@pi-configurator/protocol";
import { formatNumber, parseNumber } from "../format/numbers";

export type Draft = { kind: "text"; text: string } | { kind: "value"; value: SettingValue } | { kind: "reset" };

export type Drafts = Record<string, Draft>;

export interface FieldGroup {
  /** `undefined` for fields that name no group. */
  title?: string;
  fields: DescribedField[];
}

/** Groups in first-seen order; fields keep their order inside a group. */
export function groupFields(fields: DescribedField[]): FieldGroup[] {
  const groups: FieldGroup[] = [];
  const byTitle = new Map<string | undefined, FieldGroup>();
  for (const field of fields) {
    let group = byTitle.get(field.group);
    if (!group) {
      group = { title: field.group, fields: [] };
      byTitle.set(field.group, group);
      groups.push(group);
    }
    group.fields.push(field);
  }
  return groups;
}

export const isStoreField = (field: DescribedField): boolean => "store" in field.target;
/** Settings the Pi applies to the OS (Wi-Fi, hostname, time zone): the "Device & Network" page.
 * Everything else (the config's own settings) is on "Application Settings". */
export const isSystemField = (field: DescribedField): boolean => "system" in field.target;
export const isSecretField = (field: DescribedField): boolean => field.type === "string" && field.secret === true;
export const isNumberField = (field: DescribedField): boolean => field.type === "integer" || field.type === "number";

/** The current (saved or live) value of a non-secret field, or undefined. */
export function currentValue(state: ValueState | undefined): SettingValue | null | undefined {
  if (!state || state.secret) return undefined;
  const value = state.value;
  // The Wi-Fi state is a connection report, not a settable value.
  if (value !== null && typeof value === "object" && "connected" in value) return undefined;
  return value as SettingValue | null;
}

/** What a text or number input shows before the user edits it. Numbers get thousands separators. */
export function initialText(field: DescribedField, state: ValueState | undefined): string {
  if (isSecretField(field)) return "";
  const value = currentValue(state);
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  return typeof value === "string" ? value : "";
}

export type Resolved = { ok: true; value: SettingValue | null } | { ok: false; error: string };

/** Turns a draft into the value to send, checking it the same way the Pi will. */
export function resolveDraft(field: DescribedField, draft: Draft): Resolved {
  if (draft.kind === "reset") {
    return isStoreField(field) ? { ok: true, value: null } : { ok: false, error: "System settings can't be reset" };
  }
  let value: SettingValue;
  if (draft.kind === "text") {
    if (isNumberField(field)) {
      if (draft.text.trim() === "") return { ok: false, error: "Enter a number" };
      const parsed = parseNumber(draft.text);
      if (parsed === undefined) return { ok: false, error: "Must be a number" };
      value = parsed;
    } else {
      value = draft.text;
    }
  } else {
    value = draft.value;
  }
  const problem = validateValue(field, value);
  return problem ? { ok: false, error: problem } : { ok: true, value };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a draft would change anything. An empty secret input means "keep the current one". */
export function isChange(field: DescribedField, state: ValueState | undefined, draft: Draft | undefined): boolean {
  if (!draft) return false;
  if (draft.kind === "reset") return state?.source === "saved";
  if (isSecretField(field)) return draft.kind === "text" ? draft.text !== "" : true;
  if (draft.kind === "text") {
    if (draft.text === initialText(field, state)) return false;
    const resolved = resolveDraft(field, draft);
    return !resolved.ok || !sameValue(resolved.value, currentValue(state));
  }
  return !sameValue(draft.value, currentValue(state));
}

export interface PendingChanges {
  /** Ready to send with settings.set. */
  values: Record<string, SettingValue | null>;
  /** Fields whose draft is not valid; nothing should be sent while this is not empty. */
  errors: Record<string, string>;
  count: number;
}

export function pendingChanges(
  fields: DescribedField[],
  values: Record<string, ValueState>,
  drafts: Drafts,
): PendingChanges {
  const out: PendingChanges = { values: {}, errors: {}, count: 0 };
  for (const field of fields) {
    const draft = drafts[field.key];
    if (!draft || !isChange(field, values[field.key], draft)) continue;
    out.count++;
    const resolved = resolveDraft(field, draft);
    if (resolved.ok) out.values[field.key] = resolved.value;
    else out.errors[field.key] = resolved.error;
  }
  return out;
}

/** "100 – 5,000 ms · steps of 50", or undefined when the field has no limits. */
export function limitsText(field: DescribedField): string | undefined {
  if (field.type !== "integer" && field.type !== "number") return undefined;
  const unit = field.unit ? ` ${field.unit}` : "";
  const parts: string[] = [];
  const { min, max, step } = field;
  if (min !== undefined && max !== undefined) parts.push(`${formatNumber(min)} – ${formatNumber(max)}${unit}`);
  else if (min !== undefined) parts.push(`At least ${formatNumber(min)}${unit}`);
  else if (max !== undefined) parts.push(`At most ${formatNumber(max)}${unit}`);
  if (step !== undefined) parts.push(`steps of ${formatNumber(step)}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** A short label for where a value came from. */
export function sourceLabel(state: ValueState | undefined): string | undefined {
  switch (state?.source) {
    case "saved":
      return "Saved";
    case "default":
      return "Default";
    case "system":
      return "From the device";
    case "none":
      return "Not set";
    default:
      return undefined;
  }
}

/** The label of a select field's value, or the raw value when it isn't one of the options. */
export function optionLabel(field: DescribedField, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (field.type === "select") return field.options?.find((o) => o.value === value)?.label ?? value;
  return value;
}
