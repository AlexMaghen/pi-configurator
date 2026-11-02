/**
 * Expo app config for the pi-configurator phone app.
 *
 * Native folders (ios/, android/) are generated from this file by `expo prebuild` and are not
 * checked in. Bluetooth needs a development build (expo-dev-client); it does not run in Expo Go.
 *
 * OWNER TO CONFIRM: the bundle identifier / Android package below is a placeholder.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

/** Placeholder until the owner picks the final identifier (it can't change after store release). */
const APP_ID = "com.alexmaghen.piconfigurator";

const BLUETOOTH_REASON =
  "pi-configurator uses Bluetooth to find your Raspberry Pi devices nearby and change their settings.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "pi-configurator",
  slug: "pi-configurator",
  scheme: "piconfigurator",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: BLUETOOTH_REASON,
      ITSAppUsesNonExemptEncryption: false,
      // Hide expo-dev-menu's floating gear button in dev builds: it sits over the header's right
      // button. The dev menu is still available by shaking the device or pressing Cmd+D.
      EXDevMenuShowFloatingActionButton: false,
    },
  },
  android: {
    package: APP_ID,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    // BLUETOOTH_SCAN / BLUETOOTH_CONNECT (Android 12+) and location (Android 11 and older) are
    // added by the react-native-ble-plx plugin below.
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-dev-client",
    [
      "react-native-ble-plx",
      {
        isBackgroundEnabled: false,
        modes: [],
        // Scanning is not used to derive location, so Android 12+ skips the location prompt.
        neverForLocation: true,
        bluetoothAlwaysPermission: BLUETOOTH_REASON,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
