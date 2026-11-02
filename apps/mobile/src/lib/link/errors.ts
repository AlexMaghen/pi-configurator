/**
 * Errors raised by `DeviceLink`. One class carries both the Pi's RPC error codes and the
 * client-side failures (timeouts, dropped connections, a device that fails its own proof).
 */
import type { ErrorCode } from "@pi-configurator/protocol";

/** Failures detected on the phone rather than reported by the Pi. */
export type LocalErrorCode =
  | "timeout" // no response in time
  | "closed" // the connection dropped or was closed
  | "session_expired" // the session idled out or the Pi ended it
  | "bad_response" // the Pi sent something that doesn't match the protocol
  | "verify_failed" // the device could not prove it knows the password
  | "unsupported_protocol"; // `info.protocol` is a version this app doesn't speak

export type LinkErrorCode = ErrorCode | LocalErrorCode;

export class LinkError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LinkError";
  }

  /** `details.retryAfterS` of a `rate_limited` error, when present. */
  get retryAfterS(): number | undefined {
    const value = this.details?.retryAfterS;
    return typeof value === "number" ? value : undefined;
  }
}

/** Shown when the device refuses writes because another phone is connected to it. */
export const BUSY_MESSAGE =
  "The device is busy with another phone. Disconnect that phone (or wait for it to finish), then try again.";

export const isLinkError = (err: unknown, code?: LinkErrorCode): err is LinkError =>
  err instanceof LinkError && (code === undefined || err.code === code);

/** A short message for any thrown value, for showing in the UI. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
