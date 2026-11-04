/**
 * RPC messages exchanged over the `rpc-in` / `rpc-out` characteristics.
 *
 * Every message is one JSON object, UTF-8 encoded, then (after the handshake) encrypted as a whole
 * by `session.ts`, then split into frames by `framing.ts`. The handshake (`auth.*`) and errors
 * before it are sent in plain text; everything else is refused until the session is unlocked.
 */
import { z } from "zod";
import { BluetoothName, DeviceSettings, SettingGroup, WifiValue } from "./config";

export const PROTOCOL_VERSION = 1;

/** Readable without a session from the `info` characteristic. */
export const DeviceInfo = z.object({
  protocol: z.int(),
  name: z.string(),
  model: z.string().optional(),
  serviceVersion: z.string(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

/** Base64 (standard alphabet, padded) used for every binary value in RPC messages. */
const B64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

// ---------------------------------------------------------------------------------------------
// Setting values
// ---------------------------------------------------------------------------------------------

/** A value the phone can send for a field. `null` in `settings.set` resets a store field. */
export const SettingValue = z.union([z.string(), z.number(), z.boolean(), WifiValue]);
export type SettingValue = z.infer<typeof SettingValue>;

/**
 * Where a value came from: saved by the phone, the config default, read live from the system,
 * or nothing at all.
 */
export const ValueSource = z.enum(["saved", "default", "system", "none"]);

/** A non-secret field's current value. */
export const PlainValueState = z.object({
  secret: z.literal(false),
  value: SettingValue.nullable(),
  source: ValueSource,
});

/** A secret field never reveals its value, only whether it has one. */
export const SecretValueState = z.object({
  secret: z.literal(true),
  set: z.boolean(),
  source: ValueSource,
});

/**
 * Wi-Fi state: the current connection, read live from NetworkManager. The password is never sent.
 */
export const WifiValueState = z.object({
  secret: z.literal(false),
  value: z
    .object({
      ssid: z.string(),
      connected: z.boolean(),
      ipv4: z.string().optional(),
      signal: z.int().min(0).max(100).optional(),
    })
    .nullable(),
  source: ValueSource,
});

export const ValueState = z.union([PlainValueState, SecretValueState, WifiValueState]);
export type ValueState = z.infer<typeof ValueState>;

export const WifiNetwork = z.object({
  ssid: z.string(),
  signal: z.int().min(0).max(100),
  security: z.enum(["open", "wep", "wpa", "wpa2", "wpa3", "enterprise"]),
  inUse: z.boolean(),
});
export type WifiNetwork = z.infer<typeof WifiNetwork>;

export const FieldResult = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

// ---------------------------------------------------------------------------------------------
// Methods: params and result for each
// ---------------------------------------------------------------------------------------------

const Empty = z.object({}).strict();

/** One line of the device report: "Model" / "Raspberry Pi 4 Model B Rev 1.5". */
export const DetailItem = z.object({ label: z.string().min(1), value: z.string() });
/** A titled group of the device report ("Hardware", "Operating system", "Wi-Fi", ...). */
export const DetailSection = z.object({ title: z.string().min(1), items: z.array(DetailItem) });
export type DetailSection = z.infer<typeof DetailSection>;

/**
 * Method table. Keys are method names; `auth` says whether a session is required.
 * The service and app both derive their types from this table.
 */
export const Methods = {
  /** SRP step 1: phone sends A, Pi answers with salt and B. */
  "auth.start": {
    auth: false,
    params: z.object({ A: B64 }).strict(),
    result: z.object({ salt: B64, B: B64 }),
  },
  /** SRP step 2: phone proves the password with M1, Pi proves it back with M2. */
  "auth.finish": {
    auth: false,
    params: z.object({ M1: B64 }).strict(),
    result: z.object({ M2: B64, idleTimeoutS: z.int().positive() }),
  },
  /**
   * The config's two settings sections as they are in the file (a secret item's default is
   * removed), plus the Pi's time zone list when the time zone setting is on. The phone draws
   * Device & Network from `deviceSettings` (see device.ts) and Application Settings from
   * `appSettings`.
   */
  "settings.describe": {
    auth: true,
    params: Empty,
    result: z.object({
      deviceSettings: DeviceSettings,
      appSettings: z.array(SettingGroup),
      /** The config's `deviceDescription`, when it has one. */
      deviceDescription: z.string().optional(),
      /** Every time zone the Pi knows, when `deviceSettings.timezone` is on. */
      timezones: z.array(z.string()).optional(),
    }),
  },
  "settings.get": {
    auth: true,
    params: z.object({ keys: z.array(z.string()).optional() }).strict(),
    result: z.object({ values: z.record(z.string(), ValueState) }),
  },
  /**
   * Changes some fields at once. All are validated first: if any is invalid (or unknown), nothing
   * is saved and the Pi answers `invalid_params` with `details` mapping each bad key to a message.
   * Per-key `ok: false` results only report failures while applying valid values (e.g. a Wi-Fi
   * join that failed, or a store write error).
   */
  "settings.set": {
    auth: true,
    params: z.object({ values: z.record(z.string(), SettingValue.nullable()) }).strict(),
    result: z.object({
      results: z.record(z.string(), FieldResult),
      restarted: z.array(z.string()),
      /** Units reloaded (onChange.reload). */
      reloaded: z.array(z.string()),
    }),
  },
  "wifi.scan": {
    auth: true,
    params: Empty,
    result: z.object({ networks: z.array(WifiNetwork) }),
  },
  /**
   * A read-only report about the device for support: hardware, operating system, network,
   * Bluetooth and the service. Sections and lines appear only when the Pi can read them, so the
   * phone shows whatever comes back, in order.
   */
  "system.details": {
    auth: true,
    params: Empty,
    result: z.object({ sections: z.array(DetailSection) }),
  },
  /** Only when `deviceSettings.allowReboot`. The Pi answers, then reboots about 1 s later. */
  "system.reboot": {
    auth: true,
    params: Empty,
    result: z.object({ rebooting: z.literal(true) }),
  },
  /** Only when `deviceSettings.allowAccessChanges`. Ends every other session. */
  "access.setPassword": {
    auth: true,
    params: z.object({ password: z.string().min(1).max(128) }).strict(),
    result: Empty,
  },
  /** Only when `deviceSettings.allowAccessChanges`. The Pi re-advertises under the new name. */
  "access.setName": {
    auth: true,
    params: z.object({ name: BluetoothName }).strict(),
    result: Empty,
  },
} as const;

export type MethodName = keyof typeof Methods;
export type MethodParams<M extends MethodName> = z.infer<(typeof Methods)[M]["params"]>;
export type MethodResult<M extends MethodName> = z.infer<(typeof Methods)[M]["result"]>;
export const METHOD_NAMES = Object.keys(Methods) as MethodName[];

// ---------------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------------

export const ERROR_CODES = [
  "bad_request", // not valid JSON or not a known envelope
  "unknown_method",
  "invalid_params", // `details` maps setting keys (settings.set) or param paths (others) to messages
  "unauthenticated", // method needs a session
  "auth_failed", // wrong password
  "rate_limited", // too many wrong passwords; `details.retryAfterS`
  "forbidden", // a permission in the config is off
  "busy", // another change is still being applied
  "internal",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * Notes on envelopes:
 * - A response with `id: 0` answers a message whose id couldn't be read (e.g. bad_request).
 * - The Pi serves one phone at a time over BLE; another phone's writes are refused at the GATT
 *   level until the first disconnects.
 * - `session.ending` is sent encrypted under the session that is ending.
 */
export const Request = z.object({
  id: z.int().min(1).max(0xffff),
  method: z.enum(METHOD_NAMES as [MethodName, ...MethodName[]]),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type Request = z.infer<typeof Request>;

export const RpcError = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type RpcError = z.infer<typeof RpcError>;

// Error first: `result: z.unknown()` would also accept an object that has no `result` key.
export const Response = z.union([
  z.object({ id: z.int(), error: RpcError }),
  z.object({ id: z.int(), result: z.unknown() }),
]);
export type Response = z.infer<typeof Response>;

/** Progress the Pi pushes while applying changes. */
export const StatusEvent = z.object({
  event: z.literal("status"),
  kind: z.enum([
    "wifi.connecting",
    "wifi.connected",
    "wifi.failed",
    "hostname.changed",
    "timezone.changed",
    "store.saved",
    "service.restarting",
    "service.restarted",
    "service.reloading",
    "service.reloaded",
    "service.failed",
    "system.rebooting",
    "session.ending",
  ]),
  message: z.string(),
  key: z.string().optional(),
  unit: z.string().optional(),
});
export type StatusEvent = z.infer<typeof StatusEvent>;

/** Anything the Pi sends on `rpc-out`. */
export const Outgoing = z.union([Response, StatusEvent]);
export type Outgoing = z.infer<typeof Outgoing>;
