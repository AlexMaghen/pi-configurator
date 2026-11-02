import { describe, expect, it } from "vitest";
import { Outgoing, Request, Response } from "../src/rpc";

describe("envelopes", () => {
  it("tells errors from results", () => {
    const err = Response.parse({ id: 1, error: { code: "forbidden", message: "no" } });
    expect("error" in err).toBe(true);
    const ok = Response.parse({ id: 2, result: { rebooting: true } });
    expect("result" in ok).toBe(true);
  });

  it("parses status events", () => {
    expect(Outgoing.parse({ event: "status", kind: "wifi.connected", message: "Connected" })).toBeTruthy();
  });

  it("rejects unknown methods", () => {
    expect(Request.safeParse({ id: 1, method: "shell.exec" }).success).toBe(false);
  });
});
