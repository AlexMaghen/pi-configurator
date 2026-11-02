/**
 * Envelope edge cases that the demo device never produces, driven by a hand-written connection:
 * an error with `id: 0` (the Pi couldn't read the request id) goes to the oldest waiting request.
 */
import { describe, expect, it } from "vitest";
import { FrameAssembler, splitMessage, utf8 } from "@pi-configurator/protocol";
import { DeviceLink } from "../src/lib/link/DeviceLink";
import type { GattConnection } from "../src/lib/transport/types";
import { randomBytes } from "./support";

function scriptedConnection(reply: (message: unknown) => unknown): GattConnection {
  const listeners = new Set<(frame: Uint8Array) => void>();
  const assembler = new FrameAssembler();
  return {
    mtu: 185,
    readInfo: async () => utf8(JSON.stringify({ protocol: 1, name: "Scripted", serviceVersion: "test" })),
    writeFrame: async (frame) => {
      const message = assembler.push(frame);
      if (!message) return;
      const answer = reply(JSON.parse(new TextDecoder().decode(message.payload)));
      setTimeout(() => {
        for (const f of splitMessage(utf8(JSON.stringify(answer)), false, 182)) for (const l of listeners) l(f);
      }, 0);
    },
    onFrame: (l) => (listeners.add(l), () => listeners.delete(l)),
    onDisconnect: () => () => undefined,
    close: async () => undefined,
  };
}

describe("envelopes", () => {
  it("routes an id-0 error to the oldest pending request", async () => {
    const link = await DeviceLink.open(
      scriptedConnection(() => ({ id: 0, error: { code: "bad_request", message: "Unreadable request" } })),
      { randomBytes, yieldToUi: async () => undefined },
    );
    await expect(link.unlock("whatever")).rejects.toMatchObject({ code: "bad_request", message: "Unreadable request" });
    expect(link.state).toBe("locked");
  });
});
