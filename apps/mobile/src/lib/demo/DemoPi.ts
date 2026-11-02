/**
 * DemoPi: a pretend pi-configurator device that lives in the app's memory.
 *
 * It plays the Pi's side of the real protocol (SrpServer, piSession, framing, the RPC methods
 * and status events), so the app's `DeviceLink` and every screen can be exercised without a
 * Raspberry Pi or a Bluetooth radio: in the iOS Simulator, in tests, and in dev builds.
 *
 * What it fakes: a Wi-Fi radio with a few networks, the hostname and timezone handlers, a
 * key/value store with config defaults, service restarts and reboots. Permissions from the
 * config are honored. Timing is configurable so tests can run with no delays.
 *
 * It is *not* the reference implementation; the Python service is. Where the protocol leaves a
 * choice open, this file notes the choice it made.
 */
import {
  AUTH_BACKOFF,
  FrameAssembler,
  MAX_BLUETOOTH_NAME_BYTES,
  frameSizeForMtu,
  Methods,
  PROTOCOL_VERSION,
  SESSION_IDLE_TIMEOUT_S,
  SRP_IDENTITY,
  GROUP_3072_SHA512,
  SrpServer,
  computeVerifier,
  describeField,
  fromBase64,
  fromUtf8,
  piSession,
  splitMessage,
  toBase64,
  utf8,
  validateValue,
  type Channel,
  type Config,
  type ErrorCode,
  type Field,
  type MethodName,
  type SettingValue,
  type StatusEvent,
  type ValueState,
  type WifiNetwork,
  type WifiValue,
} from "@pi-configurator/protocol";
import { timezoneChoices } from "../form/timezones";
import { BUSY_MESSAGE, LinkError } from "../link/errors";
import type { GattConnection } from "../transport/types";

export interface DemoPiOptions {
  /** A parsed config file (see `demoConfig.ts`). */
  config: Config;
  model?: string;
  randomBytes: (length: number) => Uint8Array;
  /** ATT MTU this device reports. 23 (the BLE minimum) gives 20-byte frames. */
  mtu?: number;
  /** Simulated work in ms. Tests pass 0 for everything. */
  delays?: Partial<DemoDelays>;
  now?: () => number;
}

export interface DemoDelays {
  /** Between notification frames. */
  frame: number;
  wifiScan: number;
  wifiJoin: number;
  restart: number;
  /** From the reboot answer until the connection drops. */
  rebootDrop: number;
  /** How long the device is gone while "rebooting". */
  rebootDown: number;
}

const DEFAULT_DELAYS: DemoDelays = {
  frame: 0,
  wifiScan: 1200,
  wifiJoin: 1800,
  restart: 700,
  rebootDrop: 1000,
  rebootDown: 6000,
};

/** A network the fake radio can see. `password` undefined means open. */
interface FakeNetwork extends WifiNetwork {
  /** Join always fails with this message (to show the failure path). */
  failWith?: string;
}

const FAKE_NETWORKS: FakeNetwork[] = [
  { ssid: "HomeNet", signal: 82, security: "wpa2", inUse: false },
  { ssid: "Studio 5G", signal: 64, security: "wpa3", inUse: false },
  { ssid: "CoffeeShop Guest", signal: 41, security: "open", inUse: false },
  { ssid: "Neighbors", signal: 23, security: "wpa2", inUse: false, failWith: "Wrong Wi-Fi password" },
  { ssid: "Old Router", signal: 12, security: "wep", inUse: false },
];

class RpcFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const utf8Length = (s: string) => utf8(s).length;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DemoPi {
  private name: string;
  private password: string;
  private salt: Uint8Array;
  private verifier: bigint;
  private readonly fields: Field[];
  private readonly store = new Map<string, SettingValue>();
  private hostname: string;
  private timezone: string;
  private wifi: { ssid: string; connected: boolean; ipv4?: string; signal?: number } | null = {
    ssid: "HomeNet",
    connected: true,
    ipv4: "192.168.1.40",
    signal: 82,
  };
  /** Saved Wi-Fi profiles (SSID to password), as NetworkManager keeps them. */
  private readonly knownNetworks = new Map<string, string>([["HomeNet", "demo-home-pass"]]);
  /** Simulates a second phone holding the device (the Pi serves one phone at a time). */
  otherPhoneConnected = false;
  private failures = 0;
  private lockedUntil = 0;
  private downUntil = 0;
  private connection?: DemoConnection;
  private readonly delays: DemoDelays;
  private readonly now: () => number;

  constructor(private readonly options: DemoPiOptions) {
    const { config } = options;
    this.name = config.bluetooth.name;
    this.password = config.access.password;
    this.fields = config.settings;
    this.delays = { ...DEFAULT_DELAYS, ...options.delays };
    this.now = options.now ?? Date.now;
    this.salt = options.randomBytes(16);
    this.verifier = computeVerifier(GROUP_3072_SHA512, SRP_IDENTITY, this.password, this.salt);
    this.hostname = this.defaultOf("hostname") ?? "raspberrypi";
    this.timezone = this.defaultOf("timezone") ?? "UTC";
  }

  /** Advertised name (changes with `access.setName`). */
  get advertisedName(): string {
    return this.name;
  }

  get model(): string | undefined {
    return this.options.model;
  }

  /** False while the device is "rebooting". */
  get advertising(): boolean {
    return this.now() >= this.downUntil;
  }

  /** Opens a connection. A device takes one phone at a time; a new one replaces the old one. */
  connect(): GattConnection {
    if (!this.advertising) throw new Error("The device is not reachable");
    this.connection?.drop("Another phone connected");
    this.connection = new DemoConnection(this, this.options.mtu ?? 185, this.delays.frame);
    return this.connection;
  }

  // -------------------------------------------------------------------------------------------
  // Used by DemoConnection
  // -------------------------------------------------------------------------------------------

  infoBytes(): Uint8Array {
    return utf8(
      JSON.stringify({ protocol: PROTOCOL_VERSION, name: this.name, model: this.options.model, serviceVersion: "demo" }),
    );
  }

  /** Handles one message. Returns the response object (or nothing for no reply). */
  async handle(conn: DemoConnection, raw: unknown, encrypted: boolean): Promise<object> {
    const id = typeof raw === "object" && raw && "id" in raw && typeof raw.id === "number" ? raw.id : 0;
    try {
      if (typeof raw !== "object" || raw === null || typeof (raw as { method?: unknown }).method !== "string") {
        throw new RpcFailure("bad_request", "Not a request");
      }
      const { method, params } = raw as { method: string; params?: unknown };
      if (!(method in Methods)) throw new RpcFailure("unknown_method", `Unknown method ${method}`);
      const spec = Methods[method as MethodName];
      const checked = spec.params.safeParse(params ?? {});
      if (!checked.success) throw new RpcFailure("invalid_params", checked.error.issues[0]?.message ?? "Bad params");

      if (spec.auth) {
        if (!encrypted || !conn.session) throw new RpcFailure("unauthenticated", "Unlock the device first");
        if (this.now() - conn.lastActivity > SESSION_IDLE_TIMEOUT_S * 1000) {
          conn.endSession();
          throw new RpcFailure("unauthenticated", "The session timed out");
        }
      }
      conn.lastActivity = this.now();
      const result = await this.dispatch(conn, method as MethodName, checked.data as Record<string, unknown>);
      return { id, result };
    } catch (err) {
      if (err instanceof RpcFailure) {
        return { id, error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
      }
      return { id, error: { code: "internal", message: String(err) } };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Methods
  // -------------------------------------------------------------------------------------------

  private async dispatch(conn: DemoConnection, method: MethodName, params: Record<string, unknown>): Promise<unknown> {
    const { permissions } = this.options.config;
    switch (method) {
      case "auth.start": {
        this.checkRateLimit();
        const A = fromBase64(params.A as string);
        const server = new SrpServer(this.salt, this.verifier, this.options.randomBytes(32));
        conn.pendingAuth = { A, server };
        return { salt: toBase64(this.salt), B: toBase64(server.B) };
      }
      case "auth.finish": {
        this.checkRateLimit();
        const pending = conn.pendingAuth;
        conn.pendingAuth = undefined;
        if (!pending) throw new RpcFailure("bad_request", "Call auth.start first");
        try {
          const { sessionKey, M2 } = pending.server.verify(pending.A, fromBase64(params.M1 as string));
          this.failures = 0;
          conn.startSession(sessionKey, this.now());
          return { M2: toBase64(M2), idleTimeoutS: SESSION_IDLE_TIMEOUT_S };
        } catch {
          this.recordFailure();
          throw new RpcFailure("auth_failed", "Wrong password");
        }
      }
      case "settings.describe":
        // Like the Pi: a timezone field without options gets the system's list filled in.
        return {
          fields: this.fields.map((f) =>
            f.type === "select" && !f.options && "system" in f.target && f.target.system === "timezone"
              ? { ...describeField(f), options: timezoneChoices().map((z) => ({ value: z, label: z.replace(/_/g, " ") })) }
              : describeField(f),
          ),
          permissions,
        };
      case "settings.get": {
        const keys = (params.keys as string[] | undefined) ?? this.fields.map((f) => f.key);
        const values: Record<string, ValueState> = {};
        for (const key of keys) {
          const field = this.fields.find((f) => f.key === key);
          if (field) values[key] = this.stateOf(field);
        }
        return { values };
      }
      case "settings.set":
        return this.set(conn, params.values as Record<string, SettingValue | null>);
      case "wifi.scan":
        await sleep(this.delays.wifiScan);
        return {
          networks: FAKE_NETWORKS.map(({ failWith: _f, ...n }) => ({ ...n, inUse: this.wifi?.ssid === n.ssid })),
        };
      case "system.reboot": {
        if (!permissions.allowReboot) throw new RpcFailure("forbidden", "Reboot is turned off for this device");
        await conn.notify(this.status("system.rebooting", "Rebooting"));
        setTimeout(() => {
          this.downUntil = this.now() + this.delays.rebootDown;
          conn.drop("The device is rebooting");
        }, this.delays.rebootDrop);
        return { rebooting: true };
      }
      case "access.setPassword": {
        if (!permissions.allowAccessChanges) throw new RpcFailure("forbidden", "Access changes are turned off");
        this.password = params.password as string;
        this.salt = this.options.randomBytes(16);
        this.verifier = computeVerifier(GROUP_3072_SHA512, SRP_IDENTITY, this.password, this.salt);
        return {};
      }
      case "access.setName": {
        if (!permissions.allowAccessChanges) throw new RpcFailure("forbidden", "Access changes are turned off");
        const name = params.name as string;
        if (utf8Length(name) > MAX_BLUETOOTH_NAME_BYTES) {
          throw new RpcFailure("invalid_params", `The name must be at most ${MAX_BLUETOOTH_NAME_BYTES} bytes`);
        }
        this.name = name;
        return {};
      }
    }
  }

  /**
   * settings.set. Choice made here (the protocol allows either): when any value is invalid,
   * nothing is saved and the answer is an `invalid_params` error whose `details` maps each bad
   * key to its message. Failures while *applying* (a Wi-Fi join) come back as `ok: false` results.
   */
  private async set(conn: DemoConnection, values: Record<string, SettingValue | null>) {
    const problems: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      const field = this.fields.find((f) => f.key === key);
      if (!field) problems[key] = "Unknown setting";
      else if (value === null) {
        if (!("store" in field.target)) problems[key] = "System settings can't be reset";
        else if (field.readOnly) problems[key] = "This setting can't be changed";
      } else {
        const problem = validateValue(field, value);
        if (problem) problems[key] = problem;
      }
    }
    if (Object.keys(problems).length > 0) {
      throw new RpcFailure("invalid_params", "Some values are not valid", problems);
    }

    const results: Record<string, { ok: true } | { ok: false; error: string }> = {};
    const restart = new Set<string>();
    let storeChanged = false;
    for (const [key, value] of Object.entries(values)) {
      const field = this.fields.find((f) => f.key === key)!;
      if ("store" in field.target) {
        if (value === null) this.store.delete(key);
        else this.store.set(key, value);
        storeChanged = true;
        results[key] = { ok: true };
      } else if (field.target.system === "hostname") {
        this.hostname = value as string;
        await conn.notify(this.status("hostname.changed", `Hostname is now ${this.hostname}`, key));
        results[key] = { ok: true };
      } else if (field.target.system === "timezone") {
        this.timezone = value as string;
        await conn.notify(this.status("timezone.changed", `Time zone is now ${this.timezone}`, key));
        results[key] = { ok: true };
      } else {
        const error = await this.joinWifi(conn, value as WifiValue, key);
        results[key] = error ? { ok: false, error } : { ok: true };
        if (error) continue;
      }
      for (const unit of field.onChange?.restart ?? []) restart.add(unit);
    }
    if (storeChanged) await conn.notify(this.status("store.saved", "Settings saved"));

    const restarted: string[] = [];
    for (const unit of restart) {
      await conn.notify(this.status("service.restarting", `Restarting ${unit}`, undefined, unit));
      await sleep(this.delays.restart);
      await conn.notify(this.status("service.restarted", `Restarted ${unit}`, undefined, unit));
      restarted.push(unit);
    }
    return { results, restarted };
  }

  private async joinWifi(conn: DemoConnection, value: WifiValue, key: string): Promise<string | undefined> {
    await conn.notify(this.status("wifi.connecting", `Connecting to ${value.ssid}`, key));
    await sleep(this.delays.wifiJoin);
    const network = FAKE_NETWORKS.find((n) => n.ssid === value.ssid);
    // No password: reuse the saved one for a known network, else join as open. "" means open.
    const password = value.password ?? this.knownNetworks.get(value.ssid) ?? "";
    let error: string | undefined;
    if (!network && !value.hidden) error = `Couldn't find ${value.ssid}`;
    else if (network?.failWith) error = network.failWith;
    else if (network && network.security !== "open" && password === "") error = `${value.ssid} needs a password`;
    if (error) {
      await conn.notify(this.status("wifi.failed", error, key));
      return error;
    }
    this.knownNetworks.set(value.ssid, password);
    const octet = 20 + Math.floor((this.options.randomBytes(1)[0] ?? 0) / 4);
    this.wifi = { ssid: value.ssid, connected: true, ipv4: `192.168.1.${octet}`, signal: network?.signal ?? 50 };
    await conn.notify(this.status("wifi.connected", `Connected to ${value.ssid}, IP ${this.wifi.ipv4}`, key));
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------

  private checkRateLimit(): void {
    const waitMs = this.lockedUntil - this.now();
    if (waitMs > 0) {
      const retryAfterS = Math.ceil(waitMs / 1000);
      throw new RpcFailure("rate_limited", `Too many wrong passwords. Try again in ${retryAfterS} s`, { retryAfterS });
    }
  }

  private recordFailure(): void {
    this.failures++;
    const over = this.failures - AUTH_BACKOFF.freeAttempts;
    if (over >= 0) {
      const waitS = Math.min(AUTH_BACKOFF.firstWaitS * 2 ** over, AUTH_BACKOFF.maxWaitS);
      this.lockedUntil = this.now() + waitS * 1000;
    }
  }

  private defaultOf(key: string): string | undefined {
    const field = this.fields.find((f) => f.key === key);
    return field && "default" in field && typeof field.default === "string" ? field.default : undefined;
  }

  private stateOf(field: Field): ValueState {
    if (field.type === "wifi") return { secret: false, value: this.wifi, source: this.wifi ? "system" : "none" };
    if ("system" in field.target) {
      const value = field.target.system === "hostname" ? this.hostname : this.timezone;
      return { secret: false, value, source: "system" };
    }
    const saved = this.store.get(field.key);
    const fallback = "default" in field ? (field.default as SettingValue | undefined) : undefined;
    if (field.type === "string" && field.secret) {
      return {
        secret: true,
        set: saved !== undefined || fallback !== undefined,
        source: saved !== undefined ? "saved" : fallback !== undefined ? "default" : "none",
      };
    }
    if (saved !== undefined) return { secret: false, value: saved, source: "saved" };
    if (fallback !== undefined) return { secret: false, value: fallback, source: "default" };
    return { secret: false, value: null, source: "none" };
  }

  private status(kind: StatusEvent["kind"], message: string, key?: string, unit?: string): StatusEvent {
    return { event: "status", kind, message, ...(key ? { key } : {}), ...(unit ? { unit } : {}) };
  }
}

/** The phone's end of one connection to the demo device, plus the Pi's per-connection state. */
class DemoConnection implements GattConnection {
  session?: { send: Channel; receive: Channel };
  pendingAuth?: { A: Uint8Array; server: SrpServer };
  lastActivity = 0;
  private closed = false;
  private readonly assembler = new FrameAssembler();
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<(reason: string) => void>();
  private outQueue: Promise<void> = Promise.resolve();
  private inQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly pi: DemoPi,
    readonly mtu: number,
    private readonly frameDelayMs: number,
  ) {}

  private get frameSize(): number {
    return frameSizeForMtu(this.mtu);
  }

  async readInfo(): Promise<Uint8Array> {
    this.assertOpen();
    return this.pi.infoBytes();
  }

  async writeFrame(frame: Uint8Array): Promise<void> {
    this.assertOpen();
    // The real Pi refuses other phones' writes at the GATT level (ATT "write not permitted").
    if (this.pi.otherPhoneConnected) throw new LinkError("busy", BUSY_MESSAGE);
    let message;
    try {
      message = this.assembler.push(frame);
    } catch {
      this.drop("The device received a broken message");
      return;
    }
    if (!message) return;
    const { payload, encrypted } = message;
    // Handle messages one at a time, in order, without holding up the write response.
    this.inQueue = this.inQueue.then(() => this.process(payload, encrypted)).catch(() => undefined);
  }

  onFrame(listener: (frame: Uint8Array) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onDisconnect(listener: (reason: string) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.drop("Closed by the app");
  }

  // -------------------------------------------------------------------------------------------

  startSession(sessionKey: Uint8Array, now: number): void {
    this.session = piSession(sessionKey);
    this.lastActivity = now;
  }

  endSession(): void {
    this.session = undefined;
  }

  /** Sends a status event (encrypted; status events only exist inside a session). */
  async notify(event: StatusEvent): Promise<void> {
    if (this.session) await this.sendMessage(event, true);
  }

  drop(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.session = undefined;
    setTimeout(() => {
      for (const listener of this.disconnectListeners) listener(reason);
      this.disconnectListeners.clear();
      this.frameListeners.clear();
    }, 0);
  }

  private async process(payload: Uint8Array, encrypted: boolean): Promise<void> {
    let plain = payload;
    if (encrypted) {
      if (!this.session) {
        await this.sendMessage({ id: 0, error: { code: "unauthenticated", message: "No session" } }, false);
        return;
      }
      try {
        plain = this.session.receive.open(payload);
      } catch {
        this.drop("A message failed to decrypt");
        return;
      }
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fromUtf8(plain));
    } catch {
      await this.sendMessage({ id: 0, error: { code: "bad_request", message: "Not JSON" } }, encrypted);
      return;
    }
    const hadSession = this.session !== undefined;
    const response = await this.pi.handle(this, raw, encrypted);
    // auth.finish starts the session, but its own answer still goes out in plain text.
    const sealed = encrypted && hadSession && this.session !== undefined;
    await this.sendMessage(response, sealed);
  }

  private sendMessage(message: object, encrypted: boolean): Promise<void> {
    const job = this.outQueue.then(async () => {
      if (this.closed) return;
      const plain = utf8(JSON.stringify(message));
      const payload = encrypted && this.session ? this.session.send.seal(plain) : plain;
      for (const frame of splitMessage(payload, encrypted && this.session !== undefined, this.frameSize)) {
        await sleep(this.frameDelayMs);
        if (this.closed) return;
        for (const listener of this.frameListeners) listener(frame);
      }
    });
    this.outQueue = job.catch(() => undefined);
    return job;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Not connected");
  }
}
