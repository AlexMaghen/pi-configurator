/**
 * DeviceLink: one conversation with one pi-configurator device over a `GattConnection`.
 *
 *   const link = await DeviceLink.open(connection, { randomBytes });
 *   link.info                                  -> DeviceInfo read from the `info` characteristic
 *   await link.unlock(password, onProgress)    -> SRP handshake, then every message is encrypted
 *   const { fields } = await link.call("settings.describe", {});
 *   link.onStatus((event) => ...)              -> StatusEvents the Pi pushes while applying
 *
 * Layers, bottom up (all from @pi-configurator/protocol):
 *   frames   splitMessage / FrameAssembler at frameSize = mtu - 3 (at least 20)
 *   crypto   plaintext during the handshake, phoneSession() AES-GCM channels after it
 *   rpc      JSON envelopes; request ids 1..65535 wrap, responses matched by id, with timeouts
 *
 * Outgoing messages go through one queue, so frames of two messages never interleave and the
 * send counter of the encrypted channel matches the order the Pi receives them in.
 * The link is transport-independent: the BLE transport and the in-memory demo device both
 * provide a `GattConnection`.
 */
import {
  DeviceInfo,
  FrameAssembler,
  frameSizeForMtu,
  Methods,
  Outgoing,
  PROTOCOL_VERSION,
  SrpClient,
  SrpError,
  SessionError,
  fromBase64,
  fromUtf8,
  phoneSession,
  splitMessage,
  toBase64,
  utf8,
  type Channel,
  type MethodName,
  type MethodParams,
  type MethodResult,
  type StatusEvent,
} from "@pi-configurator/protocol";
import type { GattConnection } from "../transport/types";
import { LinkError } from "./errors";

/** Where the link is. `locked` means connected but no session (yet, or any more). */
export type LinkState = "locked" | "unlocking" | "unlocked" | "closed";

/** Steps of `unlock()`, for a progress line in the UI. The SRP math takes a moment on phones. */
export type UnlockStep = "preparing" | "exchanging" | "proving" | "verifying";

export interface DeviceLinkOptions {
  /** Cryptographically secure random bytes (expo-crypto in the app, node:crypto in tests). */
  randomBytes: (length: number) => Uint8Array;
  /** Default response timeout. */
  timeoutMs?: number;
  /** Per-method overrides of `timeoutMs`. */
  methodTimeoutsMs?: Partial<Record<MethodName, number>>;
  /** Lets the UI paint between the slow SRP steps. Defaults to a zero-delay timer. */
  yieldToUi?: () => Promise<void>;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/** Wi-Fi joins and service restarts can take a while on the Pi. */
const DEFAULT_METHOD_TIMEOUTS_MS: Partial<Record<MethodName, number>> = {
  "settings.set": 90_000,
  "wifi.scan": 30_000,
  "auth.start": 30_000,
  "auth.finish": 30_000,
};

interface Pending {
  method: MethodName;
  resolve: (result: unknown) => void;
  reject: (err: LinkError) => void;
  timer: ReturnType<typeof setTimeout>;
}

type Session = { send: Channel; receive: Channel };

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class DeviceLink {
  readonly frameSize: number;
  private stateValue: LinkState = "locked";
  private session?: Session;
  private idleTimeoutMs = 0;
  private lastActivity = 0;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly assembler = new FrameAssembler();
  private sendQueue: Promise<void> = Promise.resolve();
  private readonly statusListeners = new Set<(event: StatusEvent) => void>();
  private readonly stateListeners = new Set<(state: LinkState, reason?: string) => void>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly now: () => number;

  private constructor(
    private readonly connection: GattConnection,
    readonly info: DeviceInfo,
    private readonly options: DeviceLinkOptions,
  ) {
    this.frameSize = frameSizeForMtu(connection.mtu);
    this.now = options.now ?? Date.now;
    this.unsubscribers.push(
      connection.onFrame((frame) => this.receiveFrame(frame)),
      connection.onDisconnect((reason) => this.shutdown(reason)),
    );
  }

  /** Reads `info` and starts listening for notifications. Closes the connection on failure. */
  static async open(connection: GattConnection, options: DeviceLinkOptions): Promise<DeviceLink> {
    let info: DeviceInfo;
    try {
      info = DeviceInfo.parse(JSON.parse(fromUtf8(await connection.readInfo())));
    } catch (err) {
      await connection.close();
      throw new LinkError("bad_response", "The device sent unreadable device info", { cause: String(err) });
    }
    if (info.protocol !== PROTOCOL_VERSION) {
      await connection.close();
      throw new LinkError(
        "unsupported_protocol",
        `This device speaks protocol version ${info.protocol}; the app supports version ${PROTOCOL_VERSION}`,
      );
    }
    return new DeviceLink(connection, info, options);
  }

  get state(): LinkState {
    return this.stateValue;
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  /**
   * Runs the SRP handshake. Resolves once both sides proved the password; rejects with
   * `auth_failed`, `rate_limited` (see `retryAfterS`) or `verify_failed`. A failed attempt
   * leaves the link `locked`, so the caller can try again on the same connection.
   */
  async unlock(password: string, onProgress?: (step: UnlockStep) => void): Promise<{ idleTimeoutS: number }> {
    if (this.stateValue !== "locked") throw new LinkError("bad_request", `Can't unlock while ${this.stateValue}`);
    this.setState("unlocking");
    const pause = this.options.yieldToUi ?? defaultYield;
    try {
      onProgress?.("preparing");
      await pause();
      const client = new SrpClient(password, this.options.randomBytes(32));

      onProgress?.("exchanging");
      const start = await this.request("auth.start", { A: toBase64(client.A) }, false);

      onProgress?.("proving");
      await pause();
      let M1: Uint8Array;
      try {
        M1 = client.respond(fromBase64(start.salt), fromBase64(start.B));
      } catch (err) {
        throw new LinkError("bad_response", "The device sent an invalid handshake value", { cause: String(err) });
      }
      const finish = await this.request("auth.finish", { M1: toBase64(M1) }, false);

      onProgress?.("verifying");
      try {
        client.verifyServer(fromBase64(finish.M2));
      } catch (err) {
        if (err instanceof SrpError) {
          // The device accepted our proof but couldn't prove itself: don't trust this connection.
          void this.close("device failed verification");
          throw new LinkError("verify_failed", "The device could not prove it knows the password");
        }
        throw err;
      }
      this.session = phoneSession(client.sessionKey);
      this.idleTimeoutMs = finish.idleTimeoutS * 1000;
      this.touch();
      this.setState("unlocked");
      return { idleTimeoutS: finish.idleTimeoutS };
    } catch (err) {
      if (this.state === "unlocking") this.setState("locked");
      throw err;
    }
  }

  /** Calls an RPC method in the unlocked session. Params and result are checked against `Methods`. */
  async call<M extends MethodName>(method: M, params: MethodParams<M>): Promise<MethodResult<M>> {
    if (this.stateValue === "closed") throw new LinkError("closed", "Disconnected from the device");
    if (this.stateValue !== "unlocked" || !this.session) {
      throw new LinkError("unauthenticated", "The device is locked");
    }
    if (this.idleTimeoutMs > 0 && this.now() - this.lastActivity > this.idleTimeoutMs) {
      this.endSession("The session timed out");
      throw new LinkError("session_expired", "The session timed out; unlock the device again");
    }
    return this.request(method, params, true);
  }

  /** Status events pushed by the Pi. Returns an unsubscribe function. */
  onStatus(listener: (event: StatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** State changes, with a reason when the session or connection ended. */
  onStateChange(listener: (state: LinkState, reason?: string) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Ends the session and closes the connection. */
  async close(reason = "Disconnected"): Promise<void> {
    if (this.stateValue === "closed") return;
    this.shutdown(reason);
    await this.connection.close();
  }

  // -------------------------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------------------------

  private request<M extends MethodName>(
    method: M,
    params: MethodParams<M>,
    encrypted: boolean,
  ): Promise<MethodResult<M>> {
    const spec = Methods[method];
    const checked = spec.params.safeParse(params);
    if (!checked.success) {
      return Promise.reject(
        new LinkError("invalid_params", checked.error.issues[0]?.message ?? "Invalid parameters"),
      );
    }

    const id = this.allocateId();
    const timeoutMs = this.options.methodTimeoutsMs?.[method] ?? DEFAULT_METHOD_TIMEOUTS_MS[method] ??
      this.options.timeoutMs ?? 15_000;

    return new Promise<MethodResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LinkError("timeout", "The device didn't answer in time"));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (raw) => {
          const parsed = spec.result.safeParse(raw);
          if (parsed.success) resolve(parsed.data as MethodResult<M>);
          else reject(new LinkError("bad_response", `Unexpected ${method} result from the device`));
        },
        reject,
        timer,
      });
      this.send({ id, method, params: checked.data }, encrypted).catch((err: unknown) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(err instanceof LinkError ? err : new LinkError("closed", "Couldn't send to the device"));
      });
    });
  }

  /** Request ids are 1..65535 and wrap; an id still waiting for its response is skipped. */
  private allocateId(): number {
    for (let tries = 0; tries < 0xffff; tries++) {
      const id = this.nextId;
      this.nextId = id >= 0xffff ? 1 : id + 1;
      if (!this.pending.has(id)) return id;
    }
    throw new LinkError("busy", "Too many requests in flight");
  }

  /** Encodes, seals (in queue order) and frames one message. */
  private send(message: object, encrypted: boolean): Promise<void> {
    const job = this.sendQueue.then(async () => {
      if (this.stateValue === "closed") throw new LinkError("closed", "Disconnected from the device");
      const plain = utf8(JSON.stringify(message));
      let payload = plain;
      if (encrypted) {
        if (!this.session) throw new LinkError("session_expired", "The session ended");
        payload = this.session.send.seal(plain);
      }
      for (const frame of splitMessage(payload, encrypted, this.frameSize)) {
        await this.connection.writeFrame(frame);
      }
      this.touch();
    });
    // Keep the queue alive after a failed job; the failure goes to the caller.
    this.sendQueue = job.catch(() => undefined);
    return job;
  }

  // -------------------------------------------------------------------------------------------
  // Receiving
  // -------------------------------------------------------------------------------------------

  private receiveFrame(frame: Uint8Array): void {
    let message;
    try {
      message = this.assembler.push(frame);
    } catch {
      // A broken frame sequence means lost data; with counters in the crypto we can't resync.
      void this.close("The connection lost data");
      return;
    }
    if (!message) return;

    let plain: Uint8Array;
    if (message.encrypted) {
      if (!this.session) {
        void this.close("The device sent an encrypted message outside a session");
        return;
      }
      try {
        plain = this.session.receive.open(message.payload);
      } catch (err) {
        void this.close(err instanceof SessionError ? "A message failed to decrypt" : String(err));
        return;
      }
    } else {
      plain = message.payload;
    }
    this.touch();

    let parsed;
    try {
      parsed = Outgoing.safeParse(JSON.parse(fromUtf8(plain)));
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success) return; // Unknown message shapes are ignored; the protocol may grow.

    const out = parsed.data;
    if ("event" in out) {
      // Status events are only trusted inside the encrypted session.
      if (!message.encrypted) return;
      for (const listener of this.statusListeners) listener(out);
      if (out.kind === "session.ending") this.endSession(out.message);
      return;
    }

    // id 0 answers a message whose id the Pi couldn't read. Messages are handled in order, so
    // it belongs to the oldest request still waiting.
    const id = out.id === 0 && "error" in out ? this.pending.keys().next().value : out.id;
    const entry = id === undefined ? undefined : this.pending.get(id);
    if (!entry || id === undefined) return; // Late answer to a request that already timed out.
    // While unlocked, only plaintext *errors* are accepted (e.g. the Pi dropped an idle session).
    if (this.session && !message.encrypted && !("error" in out)) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);

    if ("error" in out) {
      const { code, message: text, details } = out.error;
      entry.reject(new LinkError(code, text, details));
      if (code === "unauthenticated" && this.session) this.endSession("The device ended the session");
    } else {
      entry.resolve(out.result);
    }
  }

  // -------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------

  private touch(): void {
    this.lastActivity = this.now();
  }

  private setState(state: LinkState, reason?: string): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of this.stateListeners) listener(state, reason);
  }

  /** The session is gone but the connection stays: the app can unlock again. */
  private endSession(reason: string): void {
    if (!this.session) return;
    this.session = undefined;
    this.assembler.reset();
    this.rejectAll(new LinkError("session_expired", reason));
    this.setState("locked", reason);
  }

  private shutdown(reason: string): void {
    if (this.stateValue === "closed") return;
    this.session = undefined;
    this.rejectAll(new LinkError("closed", reason));
    for (const off of this.unsubscribers.splice(0)) off();
    this.setState("closed", reason);
    this.statusListeners.clear();
  }

  private rejectAll(err: LinkError): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(err);
    }
  }
}
