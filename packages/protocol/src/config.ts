/**
 * The pi-configurator config file (`/etc/pi-configurator/config.json`).
 *
 * This is the single source of truth for its shape. The JSON Schema in `json-schema/` and the
 * Python models in the service are generated from it. Rules that JSON Schema can't express
 * (unique keys, defaults within limits, handler/type pairing) live in `checkConfig` below; the
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
/** systemd unit names that `onChange.restart` may name. */
export const UNIT_NAME_PATTERN = "^[A-Za-z0-9:_.@-]+\\.(service|target|socket|timer)$";

/** Advertised Bluetooth name, used by the config file and by `access.setName`. */
export const BluetoothName = z
  .string()
  .min(1)
  .refine((s) => utf8Length(s) <= MAX_BLUETOOTH_NAME_BYTES, "Bluetooth name is longer than 29 bytes");

export const SYSTEM_HANDLERS = ["wifi", "hostname", "timezone"] as const;
export type SystemHandler = (typeof SYSTEM_HANDLERS)[number];

export const StoreTarget = z.object({ store: z.literal(true) }).strict();
export const SystemTarget = z.object({ system: z.enum(SYSTEM_HANDLERS) }).strict();
export const Target = z.union([StoreTarget, SystemTarget]);
export type Target = z.infer<typeof Target>;

export const OnChange = z
  .object({
    restart: z.array(z.string().regex(new RegExp(UNIT_NAME_PATTERN))).optional(),
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

/** Properties every field has. */
const fieldBase = {
  key: z.string().regex(new RegExp(FIELD_KEY_PATTERN)),
  label: z.string().min(1),
  group: z.string().min(1).optional(),
  help: z.string().optional(),
  readOnly: z.boolean().optional(),
  onChange: OnChange.optional(),
  target: Target,
};

export const StringField = z
  .object({
    ...fieldBase,
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
  .object({ ...fieldBase, type: z.literal("integer"), default: z.int().optional(), ...numberLimits })
  .strict();

export const NumberField = z
  .object({ ...fieldBase, type: z.literal("number"), default: z.number().optional(), ...numberLimits })
  .strict();

export const BooleanField = z
  .object({ ...fieldBase, type: z.literal("boolean"), default: z.boolean().optional() })
  .strict();

export const SelectOption = z.object({ value: z.string(), label: z.string().min(1) }).strict();

/** `options` may be left out only for the timezone handler, which supplies the full list. */
export const SelectField = z
  .object({
    ...fieldBase,
    type: z.literal("select"),
    default: z.string().optional(),
    options: z.array(SelectOption).min(1).optional(),
  })
  .strict();

export const WifiField = z
  .object({ ...fieldBase, type: z.literal("wifi"), default: WifiValue.optional() })
  .strict();

export const Field = z.discriminatedUnion("type", [
  StringField,
  IntegerField,
  NumberField,
  BooleanField,
  SelectField,
  WifiField,
]);
export type Field = z.infer<typeof Field>;
export type FieldType = Field["type"];

export const Permissions = z
  .object({
    allowReboot: z.boolean().default(false),
    allowAccessChanges: z.boolean().default(false),
  })
  .strict();
export type Permissions = z.infer<typeof Permissions>;

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
    permissions: Permissions.default({ allowReboot: false, allowAccessChanges: false }),
    export: z.object({ envFile: z.string().startsWith("/") }).strict().optional(),
    settings: z.array(Field),
  })
  .strict();

/** Which field type each system handler needs. */
export const HANDLER_FIELD_TYPE: Record<SystemHandler, FieldType> = {
  wifi: "wifi",
  hostname: "string",
  timezone: "select",
};

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
  | "handler_type_mismatch"
  | "duplicate_handler"
  | "wifi_needs_handler"
  | "min_above_max"
  | "default_out_of_range"
  | "default_not_on_step"
  | "default_pattern_mismatch"
  | "default_length"
  | "default_not_an_option"
  | "options_required"
  | "duplicate_option"
  | "bad_pattern"
  | "env_key_invalid"
  | "length_min_above_max";

const isStore = (t: Target): t is z.infer<typeof StoreTarget> => "store" in t;

/** Checks the rules JSON Schema can't express. Returns no issues for a valid config. */
export function checkConfig(config: z.infer<typeof ConfigShape>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (path: (string | number)[], code: ConfigIssueCode, message: string) =>
    issues.push({ path, code, message });

  const seenKeys = new Map<string, number>();
  const seenHandlers = new Map<SystemHandler, number>();
  const envKey = new RegExp(ENV_KEY_PATTERN);

  config.settings.forEach((field, i) => {
    const at = (...rest: (string | number)[]) => ["settings", i, ...rest];

    if (seenKeys.has(field.key)) {
      add(at("key"), "duplicate_key", `Key "${field.key}" is already used by settings[${seenKeys.get(field.key)}]`);
    } else {
      seenKeys.set(field.key, i);
    }

    if (isStore(field.target)) {
      if (field.type === "wifi") add(at("target"), "wifi_needs_handler", "Wi-Fi fields must use the wifi system handler");
      if (config.export?.envFile && !envKey.test(field.key)) {
        add(at("key"), "env_key_invalid", `Key "${field.key}" can't be written to an env file`);
      }
    } else {
      const handler = field.target.system;
      const needed = HANDLER_FIELD_TYPE[handler];
      if (field.type !== needed) {
        add(at("type"), "handler_type_mismatch", `The ${handler} handler needs a field of type "${needed}"`);
      }
      if (seenHandlers.has(handler)) {
        add(at("target"), "duplicate_handler", `The ${handler} handler is already used by settings[${seenHandlers.get(handler)}]`);
      } else {
        seenHandlers.set(handler, i);
      }
    }

    switch (field.type) {
      case "integer":
      case "number": {
        const { min, max, step } = field;
        if (min !== undefined && max !== undefined && min > max) add(at("min"), "min_above_max", "min is above max");
        const d = field.default;
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
        if (field.pattern !== undefined) {
          try {
            pattern = new RegExp(field.pattern);
          } catch {
            add(at("pattern"), "bad_pattern", "pattern is not a valid regular expression");
          }
        }
        const { minLength, maxLength } = field;
        if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
          add(at("minLength"), "length_min_above_max", "minLength is above maxLength");
        }
        const d = field.default;
        if (d !== undefined) {
          if (pattern && !pattern.test(d)) add(at("default"), "default_pattern_mismatch", "default doesn't match pattern");
          if ((minLength !== undefined && d.length < minLength) || (maxLength !== undefined && d.length > maxLength)) {
            add(at("default"), "default_length", "default is outside minLength/maxLength");
          }
        }
        break;
      }
      case "select": {
        const handler = isStore(field.target) ? undefined : field.target.system;
        if (!field.options && handler !== "timezone") {
          add(at("options"), "options_required", "select fields need options (only timezone may leave them out)");
        }
        const values = new Set<string>();
        field.options?.forEach((o, j) => {
          if (values.has(o.value)) add(at("options", j, "value"), "duplicate_option", `Option "${o.value}" is listed twice`);
          values.add(o.value);
        });
        if (field.default !== undefined && field.options && !values.has(field.default)) {
          add(at("default"), "default_not_an_option", "default is not one of the options");
        }
        break;
      }
      default:
        break;
    }
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
