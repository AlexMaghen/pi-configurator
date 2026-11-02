/**
 * Creates the one AppStore for the app and hands it to screens.
 *
 *   const store = useStore();               // call methods
 *   const session = useSession(deviceId);   // re-renders when that device's session changes
 *   const devices = useAppState((s) => s.devices);
 *
 * The demo device is on by default in dev builds (__DEV__) and off in release builds; the
 * Preferences screen can switch it either way and the choice is remembered.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { DemoTransport } from "../demo/DemoTransport";
import { randomBytes } from "../platform/random";
import { preferences, savedPasswords } from "../platform/secureStorage";
import { BleTransport } from "../transport/ble";
import { DeviceDirectory } from "../transport/directory";
import type { DiscoveredDevice } from "../transport/types";
import { AppStore, type AppState, type DeviceSession } from "./AppStore";

const StoreContext = createContext<AppStore | null>(null);

function createStore(): AppStore {
  const directory = new DeviceDirectory(new BleTransport(), new DemoTransport(randomBytes));
  return new AppStore(directory, savedPasswords, randomBytes);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  useEffect(() => {
    void preferences.showDemoDevice().then(
      (on) => store.setDemoEnabled(on ?? __DEV__),
      () => store.setDemoEnabled(__DEV__),
    );
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore() outside <AppProvider>");
  return store;
}

/** Subscribes to a slice of the state. The selector must return stored objects, not new ones. */
export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

const EMPTY_SESSION: DeviceSession = { phase: "idle", drafts: {}, saveErrors: {}, activity: [] };

export function useSession(id: string): DeviceSession {
  return useAppState((s) => s.sessions[id] ?? EMPTY_SESSION);
}

export function useDevice(id: string): DiscoveredDevice | undefined {
  return useAppState((s) => s.devices[id]);
}
