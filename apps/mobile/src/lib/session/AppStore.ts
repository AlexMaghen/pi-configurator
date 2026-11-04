/**
 * AppStore: the app's state outside React. Owns the scan, one `DeviceLink` per device, and per
 * device: the session phase, the described fields, current values, unsaved drafts and the status
 * activity log. Screens read it through `useAppState` (useSyncExternalStore) and call its methods.
 *
 * State is replaced, never mutated, so React sees every change. Passwords are reached through
 * the `PasswordVault` interface (SecureStore in the app, a Map in tests).
 */
import {
  type DescribedField,
  type DeviceInfo,
  type MethodName,
  type MethodParams,
  type MethodResult,
  type Permissions,
  type SettingValue,
  type StatusEvent,
  type ValueState,
} from "@pi-configurator/protocol";
import { DeviceLink, type UnlockStep } from "../link/DeviceLink";
import { LinkError, errorMessage, isLinkError } from "../link/errors";
import { pendingChanges, type Draft, type Drafts } from "../form/model";
import type { DeviceTransport, DiscoveredDevice, RadioState } from "../transport/types";

export interface PasswordVault {
  get(deviceId: string): Promise<string | null>;
  set(deviceId: string, password: string): Promise<void>;
  forget(deviceId: string): Promise<void>;
}

/** idle: never connected. locked: connected, no session. closed: the connection ended. */
export type SessionPhase = "idle" | "connecting" | "locked" | "unlocking" | "unlocked" | "closed";

export interface ActivityEntry {
  id: number;
  at: number;
  event: StatusEvent;
}

export interface DeviceSession {
  phase: SessionPhase;
  unlockStep?: UnlockStep;
  /** Why the session or connection ended, shown on the unlock screen. */
  notice?: string;
  info?: DeviceInfo;
  fields?: DescribedField[];
  permissions?: Permissions;
  /** The device's own description (config `deviceDescription`), shown under its name. */
  description?: string;
  values?: Record<string, ValueState>;
  drafts: Drafts;
  /** Per-key errors from the last save (from the Pi). */
  saveErrors: Record<string, string>;
  /** Newest last; capped at `MAX_ACTIVITY`. */
  activity: ActivityEntry[];
  /** What the device is busy with, e.g. "Saving", or undefined. */
  busy?: string;
}

export interface AppState {
  radio: RadioState;
  scanning: boolean;
  demoEnabled: boolean;
  devices: Record<string, DiscoveredDevice>;
  sessions: Record<string, DeviceSession>;
}

export interface SaveOutcome {
  saved: string[];
  failed: Record<string, string>;
  restarted: string[];
  /** Units the Pi reloaded (onChange.reload). */
  reloaded: string[];
}

/** Like the transport, but with the demo switch the directory has. */
export interface AppTransport extends DeviceTransport {
  setDemoEnabled(on: boolean): void;
}

const MAX_ACTIVITY = 200;
/** Devices not heard from in this long drop off the list on rescan. */
const STALE_MS = 15_000;

const emptySession = (): DeviceSession => ({ phase: "idle", drafts: {}, saveErrors: {}, activity: [] });

export class AppStore {
  private state: AppState = { radio: "unknown", scanning: false, demoEnabled: false, devices: {}, sessions: {} };
  private readonly listeners = new Set<() => void>();
  private readonly links = new Map<string, DeviceLink>();
  private readonly connecting = new Map<string, Promise<DeviceLink>>();
  private stopScan?: () => void;
  private stopRadio?: () => void;
  private activityId = 0;

  constructor(
    private readonly transport: AppTransport,
    private readonly vault: PasswordVault,
    private readonly randomBytes: (length: number) => Uint8Array,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Subscription (for useSyncExternalStore)
  // -------------------------------------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): AppState => this.state;

  session(id: string): DeviceSession {
    return this.state.sessions[id] ?? emptySession();
  }

  private update(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private patchSession(id: string, patch: Partial<DeviceSession> | ((s: DeviceSession) => Partial<DeviceSession>)): void {
    const current = this.session(id);
    const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
    this.update({ sessions: { ...this.state.sessions, [id]: next } });
  }

  // -------------------------------------------------------------------------------------------
  // Scanning
  // -------------------------------------------------------------------------------------------

  startScanning(): void {
    if (!this.stopRadio) this.stopRadio = this.transport.watchRadio((radio) => this.update({ radio }));
    if (this.stopScan) return;
    this.stopScan = this.transport.scan((device) => this.seen(device));
    this.update({ scanning: true });
  }

  stopScanning(): void {
    this.stopScan?.();
    this.stopScan = undefined;
    this.update({ scanning: false });
  }

  /** Drops devices that went quiet, then scans again. */
  rescan(): void {
    this.stopScanning();
    const cutoff = Date.now() - STALE_MS;
    const devices = Object.fromEntries(
      Object.entries(this.state.devices).filter(([id, d]) => d.lastSeen >= cutoff || this.links.has(id)),
    );
    this.update({ devices });
    this.startScanning();
  }

  setDemoEnabled(on: boolean): void {
    this.transport.setDemoEnabled(on);
    const devices = on
      ? this.state.devices
      : Object.fromEntries(Object.entries(this.state.devices).filter(([, d]) => !d.demo));
    this.update({ demoEnabled: on, devices });
  }

  private seen(device: DiscoveredDevice): void {
    const previous = this.state.devices[device.id];
    // Keep what `info` told us when a later advertisement only has the radio name.
    const merged: DiscoveredDevice = {
      ...previous,
      ...device,
      model: device.model ?? previous?.model,
      protocol: device.protocol ?? previous?.protocol,
      serviceVersion: device.serviceVersion ?? previous?.serviceVersion,
    };
    this.update({ devices: { ...this.state.devices, [device.id]: merged } });
  }

  // -------------------------------------------------------------------------------------------
  // Connecting and unlocking
  // -------------------------------------------------------------------------------------------

  /** Opens (or reuses) the link to a device. */
  async connect(id: string): Promise<DeviceLink> {
    const existing = this.links.get(id);
    if (existing && existing.state !== "closed") return existing;
    const inFlight = this.connecting.get(id);
    if (inFlight) return inFlight;

    const attempt = (async () => {
      this.patchSession(id, { phase: "connecting", notice: undefined });
      try {
        const connection = await this.transport.connect(id);
        const link = await DeviceLink.open(connection, { randomBytes: this.randomBytes });
        this.attach(id, link);
        this.patchSession(id, { phase: "locked", info: link.info });
        return link;
      } catch (err) {
        this.patchSession(id, { phase: "closed", notice: `Couldn't connect: ${errorMessage(err)}` });
        throw err;
      } finally {
        this.connecting.delete(id);
      }
    })();
    this.connecting.set(id, attempt);
    return attempt;
  }

  private attach(id: string, link: DeviceLink): void {
    this.links.set(id, link);
    link.onStatus((event) => {
      const entry = { id: ++this.activityId, at: Date.now(), event };
      this.patchSession(id, (s) => ({ activity: [...s.activity, entry].slice(-MAX_ACTIVITY) }));
    });
    link.onStateChange((state, reason) => {
      if (state === "closed") {
        if (this.links.get(id) === link) this.links.delete(id);
        this.patchSession(id, { phase: "closed", notice: reason, busy: undefined, unlockStep: undefined });
      } else if (state === "locked") {
        this.patchSession(id, { phase: "locked", notice: reason, unlockStep: undefined });
      } else {
        this.patchSession(id, { phase: state });
      }
    });
  }

  /**
   * Unlocks with a typed password. On success it loads the form and, when `remember` is set,
   * saves the password for next time. Throws a `LinkError` (auth_failed, rate_limited, ...).
   */
  async unlock(id: string, password: string, options: { remember?: boolean } = {}): Promise<void> {
    const link = await this.connect(id);
    if (link.state === "unlocked") return;
    this.patchSession(id, { notice: undefined });
    try {
      await link.unlock(password, (step) => this.patchSession(id, { unlockStep: step }));
    } finally {
      this.patchSession(id, { unlockStep: undefined });
    }
    if (options.remember) {
      // Unlocking still counts if the Keychain refuses; the user just types it again next time.
      await this.vault.set(id, password).catch((err: unknown) => {
        if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[vault] couldn't save the password: ${errorMessage(err)}`);
      });
    }
    await this.load(id);
  }

  /**
   * Tries the saved password. "none": nothing saved. "failed": the saved password was wrong and
   * has been forgotten. Other errors (rate limiting, connection) are thrown.
   */
  async unlockWithSaved(id: string): Promise<"unlocked" | "none" | "failed"> {
    const saved = await this.vault.get(id).catch(() => null);
    if (!saved) return "none";
    try {
      await this.unlock(id, saved);
      return "unlocked";
    } catch (err) {
      if (isLinkError(err, "auth_failed")) {
        await this.vault.forget(id).catch(() => undefined);
        return "failed";
      }
      throw err;
    }
  }

  hasSavedPassword(id: string): Promise<boolean> {
    return this.vault.get(id).then(
      (p) => p !== null,
      () => false,
    );
  }

  forgetPassword(id: string): Promise<void> {
    return this.vault.forget(id);
  }

  rememberPassword(id: string, password: string): Promise<void> {
    return this.vault.set(id, password);
  }

  async disconnect(id: string): Promise<void> {
    await this.links.get(id)?.close("Disconnected");
  }

  // -------------------------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------------------------

  /** Calls any method in the unlocked session. */
  async call<M extends MethodName>(id: string, method: M, params: MethodParams<M>): Promise<MethodResult<M>> {
    const link = this.links.get(id);
    if (!link) throw new LinkError("closed", "Not connected to the device");
    return link.call(method, params);
  }

  /** Loads the field list and all current values. */
  async load(id: string): Promise<void> {
    const { fields, permissions, description } = await this.call(id, "settings.describe", {});
    const { values } = await this.call(id, "settings.get", {});
    this.patchSession(id, { fields, permissions, description, values });
  }

  async refreshValues(id: string, keys?: string[]): Promise<void> {
    const { values } = await this.call(id, "settings.get", keys ? { keys } : {});
    this.patchSession(id, (s) => ({ values: { ...s.values, ...values } }));
  }

  setDraft(id: string, key: string, draft: Draft | undefined): void {
    this.patchSession(id, (s) => {
      const drafts = { ...s.drafts };
      if (draft) drafts[key] = draft;
      else delete drafts[key];
      const saveErrors = { ...s.saveErrors };
      delete saveErrors[key];
      return { drafts, saveErrors };
    });
  }

  discardDrafts(id: string): void {
    this.patchSession(id, { drafts: {}, saveErrors: {} });
  }

  /** Sends the changed fields. Drafts that saved are cleared; failures land in `saveErrors`. */
  async save(id: string): Promise<SaveOutcome> {
    const s = this.session(id);
    const changes = pendingChanges(s.fields ?? [], s.values ?? {}, s.drafts);
    if (Object.keys(changes.errors).length > 0) {
      this.patchSession(id, { saveErrors: changes.errors });
      return { saved: [], failed: changes.errors, restarted: [], reloaded: [] };
    }
    const outcome = await this.apply(id, changes.values);
    this.patchSession(id, (cur) => {
      const drafts = { ...cur.drafts };
      for (const key of outcome.saved) delete drafts[key];
      return { drafts };
    });
    return outcome;
  }

  /**
   * Sends values directly (the Wi-Fi join screen uses this), then re-reads them.
   * Validation errors from the Pi (`invalid_params` with per-key `details`) and per-key apply
   * failures both come back in `failed`; other errors are thrown.
   */
  async apply(id: string, values: Record<string, SettingValue | null>): Promise<SaveOutcome> {
    const keys = Object.keys(values);
    if (keys.length === 0) return { saved: [], failed: {}, restarted: [], reloaded: [] };
    this.patchSession(id, { busy: "Saving", saveErrors: {} });
    try {
      let outcome: SaveOutcome;
      try {
        const { results, restarted, reloaded = [] } = await this.call(id, "settings.set", { values });
        outcome = { saved: [], failed: {}, restarted, reloaded };
        for (const key of keys) {
          const result = results[key];
          if (!result || result.ok) outcome.saved.push(key);
          else outcome.failed[key] = result.error;
        }
      } catch (err) {
        if (!isLinkError(err, "invalid_params")) throw err;
        outcome = { saved: [], failed: perKeyDetails(err, keys), restarted: [], reloaded: [] };
      }
      this.patchSession(id, { saveErrors: outcome.failed });
      await this.refreshValues(id).catch(() => undefined);
      return outcome;
    } finally {
      this.patchSession(id, { busy: undefined });
    }
  }

  /** After `access.setName`: the device re-advertises under the new name. */
  renamed(id: string, name: string): void {
    const s = this.session(id);
    if (s.info) this.patchSession(id, { info: { ...s.info, name } });
    const device = this.state.devices[id];
    if (device) this.update({ devices: { ...this.state.devices, [id]: { ...device, name } } });
  }
}

/** `details` of an invalid_params error as per-key messages; falls back to the error message. */
function perKeyDetails(err: LinkError, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(err.details ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  if (Object.keys(out).length === 0) for (const key of keys) out[key] = err.message;
  return out;
}
