/**
 * The pi-configurator config file (`/etc/pi-configurator/config.json`).
 *
 * This is the single source of truth for its shape. The JSON Schema in `json-schema/` and the
 * Python models in the service are generated from it. Rules that JSON Schema can't express
 * (unique and reserved keys, defaults within limits) live in `checkConfig` below; the
 * Python service re-implements them and both sides are tested against `test-vectors/config-cases.json`.
 */
import { z } from "zod";

/** Longest Bluetooth name that fits a scan response next to our 128-bit service UUID. */
export const MAX_BLUETOOTH_NAME_BYTES = 29;

const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

/** Field keys: letters, digits, `_`, `.`, `-`, starting with a letter or `_`. */
export const FIELD_KEY_PATTERN = "^[A-Za-z_][A-Za-z0-9_.-]{0,63}$";
/** Keys written to an env file must also be valid shell variable names. */
export const ENV_KEY_PATTERN = "^[A-Za-z_][A-Za-z0-9_]*$";
/** systemd unit names that `onChange.restart` and `onChange.reload` may name. */
export const UNIT_NAME_PATTERN = "^[A-Za-z0-9:_.@-]+\\.(service|target|socket|timer)$";

/** Advertised Bluetooth name, used by the config file and by `access.setName`. */
export const BluetoothName = z
  .string()
  .min(1)
  .refine((s) => utf8Length(s) <= MAX_BLUETOOTH_NAME_BYTES, "Bluetooth name is longer than 29 bytes");

/**
 * The Pi's own settings, shown on Device & Network in this fixed order. Their keys are reserved:
 * app settings can't use them. Labels and help are fixed (see `device.ts`).
 */
export const SYSTEM_SETTINGS = ["wifi", "hostname", "timezone"] as const;
export type SystemSetting = (typeof SYSTEM_SETTINGS)[number];

/** Hostnames the Pi accepts: letters, digits and hyphens, 1 to 63, no hyphen at either end. */
export const HOSTNAME_PATTERN = "^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$";

/**
 * What the Pi does after a save changes the field. `restart` restarts each unit; `reload` runs
 * `systemctl reload` (the unit's ExecReload=, usually a SIGHUP) for programs that re-read their
 * settings without restarting. A unit named under both is only restarted.
 */
export const OnChange = z
  .object({
    restart: z.array(z.string().regex(new RegExp(UNIT_NAME_PATTERN))).optional(),
    reload: z.array(z.string().regex(new RegExp(UNIT_NAME_PATTERN))).optional(),
  })
  .strict();

/**
 * Value of a Wi-Fi field. `password: ""` means an open network. A missing password reuses the
 * password of a network the Pi already knows, and means open if it doesn't know it.
 */
export const WifiValue = z
  .object({
    ssid: z.string().min(1).refine((s) => utf8Length(s) <= 32, "SSID is longer than 32 bytes"),
    password: z
      .string()
      .refine((p) => p === "" || (p.length >= 8 && p.length <= 63), "Wi-Fi password must be 8 to 63 characters")
      .optional(),
    hidden: z.boolean().optional(),
  })
  .strict();
export type WifiValue = z.infer<typeof WifiValue>;


// ---------------------------------------------------------------------------------------------
// deviceSettings: which of the Pi's own settings and actions the phone offers
// ---------------------------------------------------------------------------------------------

const systemLabel = z.string().min(1).optional();

/** `true` shows the Wi-Fi screen. The object form only relabels it. */
export const WifiSetting = z.union([z.boolean(), z.object({ label: systemLabel }).strict()]);

/**
 * `true` shows the hostname. `default` is applied on the service's first start if the Pi still
 * has a factory hostname (`raspberrypi`).
 */
export const HostnameSetting = z.union([
  z.boolean(),
  z.object({ label: systemLabel, default: z.string().regex(new RegExp(HOSTNAME_PATTERN)).optional() }).strict(),
]);

/**
 * `true` shows the time zone, chosen from every zone the Pi knows. `default` is applied on the
 * service's first start if the Pi is still on UTC.
 */
export const TimezoneSetting = z.union([
  z.boolean(),
  z.object({ label: systemLabel, default: z.string().min(1).optional() }).strict(),
]);

/** Everything missing is off. Device & Network is hidden when all of it is off. */
export const DeviceSettings = z
  .object({
    wifi: WifiSetting.optional(),
    hostname: HostnameSetting.optional(),
    timezone: TimezoneSetting.optional(),
    /** Shows a Reboot button. */
    allowReboot: z.boolean().optional(),
    /** Lets the phone change the access password and the Bluetooth name. */
    allowAccessChanges: z.boolean().optional(),
  })
  .strict();
export type DeviceSettings = z.infer<typeof DeviceSettings>;
export type WifiSetting = z.infer<typeof WifiSetting>;
export type HostnameSetting = z.infer<typeof HostnameSetting>;
export type TimezoneSetting = z.infer<typeof TimezoneSetting>;

// ---------------------------------------------------------------------------------------------
// appSettings: groups of the device's own settings, saved for its programs to read
// ---------------------------------------------------------------------------------------------

/** Properties every setting item has. */
const itemBase = {
  key: z.string().regex(new RegExp(FIELD_KEY_PATTERN)),
  label: z.string().min(1),
  help: z.string().optional(),
  readOnly: z.boolean().optional(),
  /** Replaces the group's `onChange` for this item. */
  onChange: OnChange.optional(),
};

export const StringField = z
  .object({
    ...itemBase,
    type: z.literal("string"),
    default: z.string().optional(),
    secret: z.boolean().optional(),
    pattern: z.string().optional(),
    format: z.enum(["url", "email", "multiline"]).optional(),
    minLength: z.int().nonnegative().optional(),
    maxLength: z.int().positive().optional(),
  })
  .strict();

const numberLimits = {
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  unit: z.string().optional(),
};

export const IntegerField = z
  .object({ ...itemBase, type: z.literal("integer"), default: z.int().optional(), ...numberLimits })
  .strict();

export const NumberField = z
  .object({ ...itemBase, type: z.literal("number"), default: z.number().optional(), ...numberLimits })
  .strict();

export const BooleanField = z
  .object({ ...itemBase, type: z.literal("boolean"), default: z.boolean().optional() })
  .strict();

export const SelectOption = z.object({ value: z.string(), label: z.string().min(1) }).strict();

export const SelectField = z
  .object({
    ...itemBase,
    type: z.literal("select"),
    default: z.string().optional(),
    options: z.array(SelectOption).min(1),
  })
  .strict();

/** One app setting: a field in the form, and a key in the store. */
export const SettingItem = z.discriminatedUnion("type", [
  StringField,
  IntegerField,
  NumberField,
  BooleanField,
  SelectField,
]);
export type SettingItem = z.infer<typeof SettingItem>;
export type ItemType = SettingItem["type"];

/** A heading in Application Settings and the items under it, in order. */
export const SettingGroup = z
  .object({
    groupName: z.string().min(1),
    /** A line of explanation under the heading. */
    help: z.string().optional(),
    /** What a change to any item in the group does, unless the item has its own `onChange`. */
    onChange: OnChange.optional(),
    items: z.array(SettingItem).min(1),
  })
  .strict();
export type SettingGroup = z.infer<typeof SettingGroup>;

export const ConfigShape = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    bluetooth: z
      .object({
        name: BluetoothName,
      })
      .strict(),
    access: z.object({ password: z.string().min(1).max(128) }).strict(),
    /** A few sentences about the device, shown under its name at the top of the device screen. */
    deviceDescription: z.string().max(1000).optional(),
    export: z.object({ envFile: z.string().startsWith("/") }).strict().optional(),
    /** Device & Network. Missing means all off. */
    deviceSettings: DeviceSettings.optional(),
    /** Application Settings, in order. Missing or empty hides the tab. */
    appSettings: z.array(SettingGroup).optional(),
  })
  .strict();

/** The `onChange` that applies to an item: its own, else its group's. */
export const itemOnChange = (group: SettingGroup, item: SettingItem) => item.onChange ?? group.onChange;

/** A rule broken in an otherwise well-shaped config. `path` points at the offending property. */
export interface ConfigIssue {
  path: (string | number)[];
  code: ConfigIssueCode;
  message: string;
}

/**
 * Codes for the rules in `checkConfig`. The Python service reports the same codes, which is how
 * the shared test vectors compare the two implementations.
 */
export type ConfigIssueCode =
  | "duplicate_key"
  | "reserved_key"
  | "duplicate_group"
  | "min_above_max"
  | "default_out_of_range"
  | "default_not_on_step"
  | "default_pattern_mismatch"
  | "default_length"
  | "default_not_an_option"
  | "duplicate_option"
  | "bad_pattern"
  | "env_key_invalid"
  | "length_min_above_max";

/** Checks the rules JSON Schema can't express. Returns no issues for a valid config. */
export function checkConfig(config: z.infer<typeof ConfigShape>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (path: (string | number)[], code: ConfigIssueCode, message: string) =>
    issues.push({ path, code, message });

  const seenKeys = new Map<string, string>();
  const seenGroups = new Map<string, number>();
  const envKey = new RegExp(ENV_KEY_PATTERN);
  const reserved = new Set<string>(SYSTEM_SETTINGS);

  (config.appSettings ?? []).forEach((group, g) => {
    if (seenGroups.has(group.groupName)) {
      add(["appSettings", g, "groupName"], "duplicate_group", `Group "${group.groupName}" is already used by appSettings[${seenGroups.get(group.groupName)}]`);
    } else {
      seenGroups.set(group.groupName, g);
    }

    group.items.forEach((item, i) => {
      const at = (...rest: (string | number)[]) => ["appSettings", g, "items", i, ...rest];

      if (reserved.has(item.key)) {
        add(at("key"), "reserved_key", `Key "${item.key}" is reserved for the Pi's own ${item.key} setting`);
      } else if (seenKeys.has(item.key)) {
        add(at("key"), "duplicate_key", `Key "${item.key}" is already used by ${seenKeys.get(item.key)}`);
      } else {
        seenKeys.set(item.key, `appSettings[${g}].items[${i}]`);
      }
      if (config.export?.envFile && !envKey.test(item.key)) {
        add(at("key"), "env_key_invalid", `Key "${item.key}" can't be written to an env file`);
      }

      switch (item.type) {
        case "integer":
        case "number": {
          const { min, max, step } = item;
          if (min !== undefined && max !== undefined && min > max) add(at("min"), "min_above_max", "min is above max");
          const d = item.default;
          if (d !== undefined) {
            if ((min !== undefined && d < min) || (max !== undefined && d > max)) {
              add(at("default"), "default_out_of_range", "default is outside min/max");
            }
            if (step !== undefined) {
              const steps = (d - (min ?? 0)) / step;
              if (Math.abs(steps - Math.round(steps)) > 1e-9) add(at("default"), "default_not_on_step", "default is not on a step");
            }
          }
          break;
        }
        case "string": {
          let pattern: RegExp | undefined;
          if (item.pattern !== undefined) {
            try {
              pattern = new RegExp(item.pattern);
            } catch {
              add(at("pattern"), "bad_pattern", "pattern is not a valid regular expression");
            }
          }
          const { minLength, maxLength } = item;
          if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
            add(at("minLength"), "length_min_above_max", "minLength is above maxLength");
          }
          const d = item.default;
          if (d !== undefined) {
            if (pattern && !pattern.test(d)) add(at("default"), "default_pattern_mismatch", "default doesn't match pattern");
            if ((minLength !== undefined && d.length < minLength) || (maxLength !== undefined && d.length > maxLength)) {
              add(at("default"), "default_length", "default is outside minLength/maxLength");
            }
          }
          break;
        }
        case "select": {
          const values = new Set<string>();
          item.options.forEach((o, j) => {
            if (values.has(o.value)) add(at("options", j, "value"), "duplicate_option", `Option "${o.value}" is listed twice`);
            values.add(o.value);
          });
          if (item.default !== undefined && !values.has(item.default)) {
            add(at("default"), "default_not_an_option", "default is not one of the options");
          }
          break;
        }
        default:
          break;
      }
    });
  });

  return issues;
}

/** The config file with every rule checked. Parse with `Config.safeParse(json)`. */
export const Config = ConfigShape.superRefine((config, ctx) => {
  for (const issue of checkConfig(config)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message, params: { code: issue.code } });
  }
});
export type Config = z.infer<typeof Config>;
export type ConfigInput = z.input<typeof Config>;
