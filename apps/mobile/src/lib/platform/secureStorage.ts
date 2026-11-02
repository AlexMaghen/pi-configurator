/**
 * Saved device passwords (iOS Keychain / Android Keystore through expo-secure-store) and the
 * app's few preferences.
 *
 * Keys are per device id. SecureStore keys allow only letters, digits, ".", "-" and "_", which
 * covers ble-plx ids (UUIDs on iOS, MAC addresses on Android after the ":" are replaced).
 */
import * as SecureStore from "expo-secure-store";

const keyFor = (prefix: string, id: string) => `${prefix}.${id.replace(/[^A-Za-z0-9._-]/g, "_")}`;

/** Only readable while the phone is unlocked, and never synced to other devices. */
const PASSWORD_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const savedPasswords = {
  get: (deviceId: string) => SecureStore.getItemAsync(keyFor("pw", deviceId), PASSWORD_OPTIONS),
  set: (deviceId: string, password: string) =>
    SecureStore.setItemAsync(keyFor("pw", deviceId), password, PASSWORD_OPTIONS),
  forget: (deviceId: string) => SecureStore.deleteItemAsync(keyFor("pw", deviceId), PASSWORD_OPTIONS),
};

/** App preferences. Not secret, but SecureStore saves adding another storage library. */
export const preferences = {
  async showDemoDevice(): Promise<boolean | undefined> {
    const value = await SecureStore.getItemAsync("pref.showDemoDevice");
    return value === null ? undefined : value === "1";
  },
  setShowDemoDevice: (on: boolean) => SecureStore.setItemAsync("pref.showDemoDevice", on ? "1" : "0"),
};
