/** AppStore: saved-password unlock, save flow and session loss, against the demo device. */
import { describe, expect, it } from "vitest";
import { AppStore, type AppTransport, type PasswordVault } from "../src/lib/session/AppStore";
import type { DeviceTransport } from "../src/lib/transport/types";
import { DEMO_PASSWORD, makePi, pick, restartsOf, randomBytes, testFields } from "./support";

const num = pick.number();
const next = num.default! + num.step!;

function setup() {
  const { pi, clock } = makePi();
  const transport: AppTransport = {
    scan: () => () => undefined,
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
  return { store: new AppStore(transport, vault, randomBytes), saved, pi, clock };
}

describe("AppStore", () => {
  it("remembers a password and unlocks with it next time", async () => {
    const { store, saved } = setup();
    expect(await store.unlockWithSaved("d1")).toBe("none");
    await store.unlock("d1", DEMO_PASSWORD, { remember: true });
    expect(saved.get("d1")).toBe(DEMO_PASSWORD);
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
    store.setDraft("d1", pick.hostname().key, { kind: "text", text: "ballspi" }); // unchanged
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
});
