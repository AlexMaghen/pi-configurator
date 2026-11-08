/** AppStore: saved-password unlock, save flow and session loss, against the demo device. */
import { describe, expect, it } from "vitest";
import { AppStore, type AppTransport, type PasswordVault } from "../src/lib/session/AppStore";
import type { DeviceTransport, DiscoveredDevice } from "../src/lib/transport/types";
import { DEMO_HOSTNAME, DEMO_NAME, DEMO_PASSWORD, makePi, pick, restartsOf, randomBytes, testFields } from "./support";

const num = pick.number();
const next = num.default! + num.step!;

function setup() {
  const { pi, clock } = makePi();
  let advertise: (device: DiscoveredDevice) => void = () => undefined;
  const transport: AppTransport = {
    scan: (onDevice) => ((advertise = onDevice), () => undefined),
    watchRadio: (l) => (l("on"), () => undefined),
    owns: () => true,
    connect: async () => pi.connect(),
    setDemoEnabled: () => undefined,
  } satisfies DeviceTransport & { setDemoEnabled: (on: boolean) => void };
  const saved = new Map<string, string>();
  const vault: PasswordVault = {
    get: async (id) => saved.get(id) ?? null,
    set: async (id, pw) => void saved.set(id, pw),
    forget: async (id) => void saved.delete(id),
  };
  const store = new AppStore(transport, vault, randomBytes);
  /** The device "d1" advertising under `name` (as a re-flashed board would). */
  const seenAs = (name: string) => {
    store.startScanning();
    advertise({ id: "d1", name, demo: false, lastSeen: Date.now() });
  };
  return { store, saved, pi, clock, seenAs };
}

describe("AppStore", () => {
  it("remembers a password and unlocks with it next time", async () => {
    const { store, saved } = setup();
    expect(await store.unlockWithSaved("d1")).toBe("none");
    await store.unlock("d1", DEMO_PASSWORD, { remember: true });
    expect([...saved.values()]).toEqual([DEMO_PASSWORD]);
    expect(store.session("d1").phase).toBe("unlocked");
    expect(store.session("d1").fields?.length).toBe(testFields().length);

    await store.disconnect("d1");
    expect(store.session("d1").phase).toBe("closed");
    expect(await store.unlockWithSaved("d1")).toBe("unlocked");
  });

  it("drops a saved password that no longer works", async () => {
    const { store, saved } = setup();
    saved.set("d1", "outdated-password");
    expect(await store.unlockWithSaved("d1")).toBe("failed");
    expect(saved.has("d1")).toBe(false);
  });

  it("saves only changed fields and keeps failed ones as drafts", async () => {
    const { store } = setup();
    await store.unlock("d1", DEMO_PASSWORD);
    store.setDraft("d1", num.key, { kind: "text", text: String(next) });
    store.setDraft("d1", pick.hostname().key, { kind: "text", text: DEMO_HOSTNAME }); // unchanged
    const outcome = await store.save("d1");
    expect(outcome.saved).toEqual([num.key]);
    expect(outcome.restarted).toEqual(restartsOf(num.key));
    const s = store.session("d1");
    expect(s.values?.[num.key]).toMatchObject({ value: next, source: "saved" });
    expect(s.drafts[num.key]).toBeUndefined();
    expect(s.activity.map((a) => a.event.kind)).toContain("service.restarted");
  });

  it("does not send when a draft is invalid", async () => {
    const { store } = setup();
    await store.unlock("d1", DEMO_PASSWORD);
    store.setDraft("d1", num.key, { kind: "text", text: String(num.max! + 1) });
    const outcome = await store.save("d1");
    expect(outcome.failed).toEqual({ [num.key]: `Must be at most ${num.max}` });
    expect(store.session("d1").saveErrors[num.key]).toBe(`Must be at most ${num.max}`);
  });

  it("maps the Pi's invalid_params details to per-key errors", async () => {
    const { store } = setup();
    await store.unlock("d1", DEMO_PASSWORD);
    const key = pick.hostname().key;
    const outcome = await store.apply("d1", { [key]: null });
    expect(outcome.failed[key]).toMatch(/can't be reset/);
  });

  it("resets every saved app setting and leaves the Pi's own settings", async () => {
    const { store } = setup();
    await store.unlock("d1", DEMO_PASSWORD);
    const url = pick.url();
    await store.apply("d1", { [num.key]: next, [url.key]: "http://example.com/stream" });
    store.setDraft("d1", num.key, { kind: "text", text: String(num.default) });
    const outcome = await store.resetAll("d1");
    expect(outcome.saved.sort()).toEqual([num.key, url.key].sort());
    const s = store.session("d1");
    expect(s.values?.[num.key]).toMatchObject({ value: num.default, source: "default" });
    expect(s.values?.[url.key]).toMatchObject({ source: "default" });
    expect(s.values?.[pick.hostname().key]?.source).toBe("system");
    expect(s.drafts).toEqual({});
  });

  it("sends nothing to reset when every app setting is on its default", async () => {
    const { store } = setup();
    await store.unlock("d1", DEMO_PASSWORD);
    expect(await store.resetAll("d1")).toEqual({ saved: [], failed: {}, restarted: [], reloaded: [] });
  });

  it("returns to locked when the Pi ends an idle session", async () => {
    const { store, clock } = setup();
    await store.unlock("d1", DEMO_PASSWORD);
    clock.advance(601_000); // Only the Pi's clock moves: the Pi, not the phone, notices.
    await expect(store.refreshValues("d1")).rejects.toMatchObject({ code: "unauthenticated" });
    expect(store.session("d1").phase).toBe("locked");
    expect(await store.unlockWithSaved("d1")).toBe("none");
    await store.unlock("d1", DEMO_PASSWORD);
    expect(store.session("d1").phase).toBe("unlocked");
  });

  it("doesn't reuse a password saved under the board's earlier name", async () => {
    const { store, seenAs } = setup();
    seenAs("crapula");
    await store.unlock("d1", DEMO_PASSWORD, { remember: true });
    await store.disconnect("d1");
    expect(await store.hasSavedPassword("d1")).toBe(true);

    seenAs("SomeThing"); // same Bluetooth chip, so same id, set up again under a new name
    expect(await store.hasSavedPassword("d1")).toBe(false);
    expect(await store.unlockWithSaved("d1")).toBe("none");

    seenAs("crapula");
    expect(await store.hasSavedPassword("d1")).toBe(true);
  });

  it("keeps the saved password when the device is renamed from the app", async () => {
    const { store, saved, seenAs } = setup();
    seenAs(DEMO_NAME);
    await store.unlock("d1", DEMO_PASSWORD, { remember: true });
    await store.renamed("d1", "Garage");
    expect(saved.size).toBe(1);
    expect(await store.hasSavedPassword("d1")).toBe(true);
    await store.disconnect("d1");
    expect(await store.unlockWithSaved("d1")).toBe("unlocked");
  });
});
