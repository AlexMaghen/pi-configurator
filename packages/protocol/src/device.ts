/**
 * Device & Network, as the phone draws it: the Pi's own settings that `deviceSettings` turns on,
 * as form fields with fixed labels and help, in the fixed order of `SYSTEM_SETTINGS`.
 *
 * The keys are the setting names (`wifi`, `hostname`, `timezone`); `settings.get` and
 * `settings.set` use them like any app setting's key.
 */
import {
  HOSTNAME_PATTERN,
  SYSTEM_SETTINGS,
  type DeviceSettings,
  type SelectField,
  type SettingGroup,
  type SettingItem,
  type StringField,
  type SystemSetting,
} from "./config";
import type { z } from "zod";

/** The Wi-Fi setting as a form field: opens the Wi-Fi screen. It has no config entry. */
export interface WifiField {
  key: "wifi";
  type: "wifi";
  label: string;
  help?: string;
}

/** Anything the form can show: an app setting item, or one of the Pi's own settings. */
export type FormField = SettingItem | WifiField;

/** Fixed labels and help for the Pi's own settings. `label` in the config replaces the label. */
export const SYSTEM_SETTING_TEXT: Record<SystemSetting, { label: string; help?: string }> = {
  wifi: { label: "Wi-Fi network" },
  hostname: { label: "Hostname", help: "The name the Pi uses on the network (hostname.local)." },
  timezone: { label: "Time zone" },
};

/** Whether `deviceSettings` turns on one of the Pi's own settings (`true` or an object). */
export function isOn(settings: DeviceSettings | undefined, name: SystemSetting): boolean {
  const value = settings?.[name];
  return value !== undefined && value !== false;
}

const objectForm = (settings: DeviceSettings | undefined, name: SystemSetting) => {
  const value = settings?.[name];
  return typeof value === "object" ? value : undefined;
};

/** Whether the Device & Network tab has anything to show. */
export function hasDeviceTab(settings: DeviceSettings | undefined): boolean {
  return SYSTEM_SETTINGS.some((name) => isOn(settings, name)) || !!settings?.allowReboot || !!settings?.allowAccessChanges;
}

/** Whether the Application Settings tab has anything to show. */
export const hasAppTab = (groups: SettingGroup[] | undefined): boolean => (groups ?? []).some((g) => g.items.length > 0);

export const isSystemSetting = (key: string): key is SystemSetting => (SYSTEM_SETTINGS as readonly string[]).includes(key);

/**
 * The form fields for Device & Network. `timezones` is the Pi's list of zones (from
 * `settings.describe`); without it the time zone field has no options and the phone offers its own.
 */
export function deviceFields(settings: DeviceSettings | undefined, timezones?: string[]): FormField[] {
  const out: FormField[] = [];
  const text = (name: SystemSetting) => ({
    label: objectForm(settings, name)?.label ?? SYSTEM_SETTING_TEXT[name].label,
    ...(SYSTEM_SETTING_TEXT[name].help ? { help: SYSTEM_SETTING_TEXT[name].help } : {}),
  });
  if (isOn(settings, "wifi")) out.push({ key: "wifi", type: "wifi", ...text("wifi") });
  if (isOn(settings, "hostname")) {
    const hostname: z.infer<typeof StringField> = { key: "hostname", type: "string", pattern: HOSTNAME_PATTERN, ...text("hostname") };
    out.push(hostname);
  }
  if (isOn(settings, "timezone")) {
    // An empty list stands for "not sent": the choose screen then offers the phone's own zones.
    const timezone = {
      key: "timezone",
      type: "select",
      options: (timezones ?? []).map((z) => ({ value: z, label: z.replace(/_/g, " ") })),
      ...text("timezone"),
    } as z.infer<typeof SelectField>;
    out.push(timezone);
  }
  return out;
}

/** Every app setting item, in order across the groups. */
export const appItems = (groups: SettingGroup[] | undefined): SettingItem[] => (groups ?? []).flatMap((g) => g.items);
