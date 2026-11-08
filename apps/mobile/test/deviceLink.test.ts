/**
 * DeviceLink against the demo device, end to end: framing, SRP handshake, AES-GCM session, RPC
 * methods, status events, errors and rate limiting. Both sides use the shared protocol package,
 * so this also checks the demo device behaves like the protocol says.
 */
import { describe, expect, it } from "vitest";
import { AUTH_BACKOFF, validateValue, type StatusEvent } from "@pi-configurator/protocol";
import { LinkError } from "../src/lib/link/errors";
import { DEMO_HOSTNAME, DEMO_NAME, DEMO_PASSWORD, SECRET_FIELD, makePi, openLink, pick, restartsOf, testConfig, unlockedLink } from "./support";

const num = pick.number();
const url = pick.url();
/** A valid value different from the default: one step up. */
const nextNumber = (num.default ?? num.min!) + num.step!;

const expectLinkError = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LinkError);
  expect((err as LinkError).code).toBe(code);
  return err as LinkError;
};

describe("handshake", () => {
  it("reads info and unlocks with the right password", async () => {
    const { pi, clock } = makePi();
    const link = await openLink(pi, clock);
    expect(link.info).toMatchObject({ protocol: 1, name: DEMO_NAME, model: "Test Pi" });
    expect(link.state).toBe("locked");
    const steps: string[] = [];
    const { idleTimeoutS } = await link.unlock(DEMO_PASSWORD, (s) => steps.push(s));
    expect(idleTimeoutS).toBe(600);
    expect(steps).toEqual(["preparing", "exchanging", "proving", "verifying"]);
    expect(link.state).toBe("unlocked");
  });

  it("refuses a wrong password and can retry on the same connection", async () => {
    const { pi, clock } = makePi();
    const link = await openLink(pi, clock);
    await expectLinkError(link.unlock("not-the-password"), "auth_failed");
    expect(link.state).toBe("locked");
    await link.unlock(DEMO_PASSWORD);
    expect(link.state).toBe("unlocked");
  });

  it("rate-limits after the free attempts and reports retryAfterS", async () => {
    const { pi, clock } = makePi();
    const link = await openLink(pi, clock);
    for (let i = 0; i < AUTH_BACKOFF.freeAttempts; i++) await expectLinkError(link.unlock("wrong-guess"), "auth_failed");
    const limited = await expectLinkError(link.unlock(DEMO_PASSWORD), "rate_limited");
    expect(limited.retryAfterS).toBe(AUTH_BACKOFF.firstWaitS);

    clock.advance(AUTH_BACKOFF.firstWaitS * 1000);
    // The next failure doubles the wait.
    await expectLinkError(link.unlock("wrong-again"), "auth_failed");
    const again = await expectLinkError(link.unlock(DEMO_PASSWORD), "rate_limited");
    expect(again.retryAfterS).toBe(AUTH_BACKOFF.firstWaitS * 2);

    clock.advance(AUTH_BACKOFF.firstWaitS * 2 * 1000);
    await link.unlock(DEMO_PASSWORD);
    expect(link.state).toBe("unlocked");
  });

  it("refuses calls before unlocking", async () => {
    const { pi, clock } = makePi();
    const link = await openLink(pi, clock);
    await expectLinkError(link.call("settings.describe", {}), "unauthenticated");
  });
});

describe("framing", () => {
  it("works at the smallest MTU (20-byte frames)", async () => {
    const { link } = await unlockedLink({ mtu: 23 });
    expect(link.frameSize).toBe(20);
    const { appSettings } = await link.call("settings.describe", {});
    expect(appSettings.map((g) => g.groupName)).toEqual(testConfig().appSettings!.map((g) => g.groupName));
    const set = await link.call("settings.set", { values: { [url.key]: "https://example.com/stream" } });
    expect(set.results[url.key]).toEqual({ ok: true });
  });

  it("never goes below 20-byte frames", async () => {
    const { pi, clock } = makePi({ mtu: 10 });
    const link = await openLink(pi, clock);
    expect(link.frameSize).toBe(20);
  });
});

describe("settings", () => {
  it("describes both sections as in the config, without secret defaults, plus time zones", async () => {
    const { link } = await unlockedLink({ permissions: { allowAccessChanges: false } });
    const { deviceSettings, appSettings, timezones } = await link.call("settings.describe", {});
    expect(deviceSettings).toEqual(testConfig({ allowAccessChanges: false }).deviceSettings);
    expect(deviceSettings.allowReboot).toBe(true);
    const items = appSettings.flatMap((g) => g.items);
    const secret = items.find((f) => f.key === SECRET_FIELD.key);
    expect(secret && "default" in secret).toBe(false);
    expect(appSettings.map((g) => g.groupName)).toEqual(testConfig().appSettings!.map((g) => g.groupName));
    expect(timezones).toContain("Europe/Paris");
  });

  it("leaves out the Pi's own settings that the config turns off", async () => {
    const { link } = await unlockedLink({ permissions: { hostname: false, timezone: false } });
    const { timezones } = await link.call("settings.describe", {});
    expect(timezones).toBeUndefined();
    const { values } = await link.call("settings.get", {});
    expect(values.hostname).toBeUndefined();
    const err = await expectLinkError(link.call("settings.set", { values: { hostname: "x" } }), "invalid_params");
    expect(err.details).toEqual({ hostname: "Unknown setting" });
  });

  it("gets values with their source", async () => {
    const { link } = await unlockedLink();
    const { values } = await link.call("settings.get", {});
    expect(values[num.key]).toEqual({ secret: false, value: num.default, source: "default" });
    // A secret with a config default counts as set, without revealing it.
    expect(values[SECRET_FIELD.key]).toEqual({ secret: true, set: true, source: "default" });
    expect(values[pick.hostname().key]).toMatchObject({ value: DEMO_HOSTNAME, source: "system" });
    expect(values[pick.wifi().key]).toMatchObject({ value: { ssid: "HomeNet", connected: true }, source: "system" });
    const some = await link.call("settings.get", { keys: [pick.hostname().key] });
    expect(Object.keys(some.values)).toEqual([pick.hostname().key]);
  });

  it("saves, restarts units once, streams status events and resets to default", async () => {
    const { link } = await unlockedLink();
    const events: StatusEvent[] = [];
    link.onStatus((e) => events.push(e));

    const set = await link.call("settings.set", {
      values: { [num.key]: nextNumber, [SECRET_FIELD.key]: "abc123", [pick.hostname().key]: "balls-2" },
    });
    expect(set.results).toEqual({ [num.key]: { ok: true }, [SECRET_FIELD.key]: { ok: true }, [pick.hostname().key]: { ok: true } });
    const units = [...new Set([...restartsOf(num.key), ...restartsOf(SECRET_FIELD.key)])];
    expect(set.restarted.sort()).toEqual(units.sort());
    expect(events.map((e) => e.kind)).toEqual([
      "hostname.changed",
      "store.saved",
      ...units.flatMap(() => ["service.restarting", "service.restarted"]),
    ]);

    const { values } = await link.call("settings.get", {});
    expect(values[num.key]).toEqual({ secret: false, value: nextNumber, source: "saved" });
    expect(values[SECRET_FIELD.key]).toEqual({ secret: true, set: true, source: "saved" });

    await link.call("settings.set", { values: { [num.key]: null } });
    const after = await link.call("settings.get", { keys: [num.key] });
    expect(after.values[num.key]).toEqual({ secret: false, value: num.default, source: "default" });
  });

  it("rejects invalid values per key and saves nothing", async () => {
    const { link } = await unlockedLink();
    const tooSmall = num.min! - 1;
    const err = await expectLinkError(
      link.call("settings.set", { values: { [num.key]: tooSmall, [url.key]: "nope", [pick.hostname().key]: "ok-name" } }),
      "invalid_params",
    );
    expect(err.details).toEqual({ [num.key]: validateValue(num, tooSmall), [url.key]: "Must be a URL" });
    const { values } = await link.call("settings.get", { keys: [pick.hostname().key] });
    expect(values[pick.hostname().key]).toMatchObject({ value: DEMO_HOSTNAME });
  });

  it("refuses to reset a system field", async () => {
    const { link } = await unlockedLink();
    const key = pick.hostname().key;
    const err = await expectLinkError(link.call("settings.set", { values: { [key]: null } }), "invalid_params");
    expect(err.details?.[key]).toMatch(/can't be reset/);
  });
});

describe("wifi", () => {
  it("scans networks", async () => {
    const { link } = await unlockedLink();
    const { networks } = await link.call("wifi.scan", {});
    expect(networks.length).toBeGreaterThan(3);
    expect(networks.find((n) => n.ssid === "HomeNet")?.inUse).toBe(true);
  });

  it("joins a network and reports progress", async () => {
    const { link } = await unlockedLink();
    const events: string[] = [];
    link.onStatus((e) => events.push(e.kind));
    const set = await link.call("settings.set", { values: { [pick.wifi().key]: { ssid: "Studio 5G", password: "longenough" } } });
    expect(set.results[pick.wifi().key]).toEqual({ ok: true });
    expect(events).toEqual(["wifi.connecting", "wifi.connected"]);
    const { values } = await link.call("settings.get", { keys: [pick.wifi().key] });
    expect(values[pick.wifi().key]).toMatchObject({ value: { ssid: "Studio 5G", connected: true } });
  });

  it("reuses a saved password when none is sent, and needs one for unknown secured networks", async () => {
    const { link } = await unlockedLink();
    const known = await link.call("settings.set", { values: { [pick.wifi().key]: { ssid: "HomeNet" } } });
    expect(known.results[pick.wifi().key]).toEqual({ ok: true });
    const unknown = await link.call("settings.set", { values: { [pick.wifi().key]: { ssid: "Studio 5G" } } });
    expect(unknown.results[pick.wifi().key]).toEqual({ ok: false, error: "Studio 5G needs a password" });
    const open = await link.call("settings.set", { values: { [pick.wifi().key]: { ssid: "CoffeeShop Guest", password: "" } } });
    expect(open.results[pick.wifi().key]).toEqual({ ok: true });
  });

  it("reports a failed join as a per-key result", async () => {
    const { link } = await unlockedLink();
    const set = await link.call("settings.set", { values: { [pick.wifi().key]: { ssid: "Neighbors", password: "guessing123" } } });
    expect(set.results[pick.wifi().key]).toEqual({ ok: false, error: "Wrong Wi-Fi password" });
  });

  it("checks the Wi-Fi password length before sending", async () => {
    const { link } = await unlockedLink();
    await expectLinkError(link.call("settings.set", { values: { [pick.wifi().key]: { ssid: "HomeNet", password: "short" } } }), "invalid_params");
  });
});

describe("permissions and access", () => {
  it("refuses access changes when the permission is off", async () => {
    const { link } = await unlockedLink({ permissions: { allowAccessChanges: false } });
    await expectLinkError(link.call("access.setName", { name: "Other" }), "forbidden");
    await expectLinkError(link.call("access.setPassword", { password: "new-password" }), "forbidden");
  });

  it("changes the password and name when allowed", async () => {
    const { pi, clock, link } = await unlockedLink({ permissions: { allowAccessChanges: true } });
    await link.call("access.setPassword", { password: "brand-new-pass" });
    await link.call("access.setName", { name: `${DEMO_NAME} 2` });
    await link.close();
    const next = await openLink(pi, clock);
    expect(next.info.name).toBe(`${DEMO_NAME} 2`);
    await expectLinkError(next.unlock(DEMO_PASSWORD), "auth_failed");
    await next.unlock("brand-new-pass");
    expect(next.state).toBe("unlocked");
  });

  it("reboots: answers, then the connection drops", async () => {
    const { link } = await unlockedLink();
    const closed = new Promise<string | undefined>((resolve) =>
      link.onStateChange((state, reason) => state === "closed" && resolve(reason)),
    );
    const events: string[] = [];
    link.onStatus((e) => events.push(e.kind));
    expect(await link.call("system.reboot", {})).toEqual({ rebooting: true });
    expect(events).toEqual(["system.rebooting"]);
    expect(await closed).toMatch(/rebooting/);
    await expectLinkError(link.call("settings.get", {}), "closed");
  });

  it("refuses reboot when the permission is off", async () => {
    const { link } = await unlockedLink({ permissions: { allowReboot: false } });
    await expectLinkError(link.call("system.reboot", {}), "forbidden");
  });
});

describe("one phone at a time", () => {
  it("reports a clear busy error when another phone holds the device", async () => {
    const { pi, clock } = makePi();
    const link = await openLink(pi, clock);
    pi.otherPhoneConnected = true;
    const err = await expectLinkError(link.unlock(DEMO_PASSWORD), "busy");
    expect(err.message).toMatch(/another phone/);
    expect(link.state).toBe("locked");
    pi.otherPhoneConnected = false;
    await link.unlock(DEMO_PASSWORD);
    expect(link.state).toBe("unlocked");
  });
});

describe("session lifetime", () => {
  it("expires an idle session on the phone side and can unlock again", async () => {
    const { link, clock } = await unlockedLink();
    clock.advance(601_000);
    await expectLinkError(link.call("settings.get", {}), "session_expired");
    expect(link.state).toBe("locked");
    await link.unlock(DEMO_PASSWORD);
    const { values } = await link.call("settings.get", { keys: ["hostname"] });
    expect(values.hostname).toBeDefined();
  });

  it("rejects pending calls when the connection closes", async () => {
    const { link } = await unlockedLink();
    const call = link.call("wifi.scan", {});
    await link.close("test");
    await expectLinkError(call, "closed");
    expect(link.state).toBe("closed");
  });

  it("checks params locally before sending", async () => {
    const { link } = await unlockedLink();
    // @ts-expect-error: wrong param type on purpose
    await expectLinkError(link.call("settings.get", { keys: "hostname" }), "invalid_params");
  });
});
