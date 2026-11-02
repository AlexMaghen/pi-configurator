/**
 * Expo app config for the pi-configurator phone app.
 *
 * Native folders (ios/, android/) are generated from this file by `expo prebuild` and are not
 * checked in. Bluetooth needs a development build (expo-dev-client); it does not run in Expo Go.
 *
 * The app's short name (under the icon) is "pi-fig". Icons are drawn by store/scripts/make-icons.sh.
 */
import type { ConfigContext, ExpoConfig } from "expo/config";

/** iOS bundle ID and Android package (chosen 2026-11-02; can't change after a store release). */
const APP_ID = "com.alexmaghen.pifig";

const BLUETOOTH_REASON =
  "pi-fig uses Bluetooth to find your Raspberry Pi devices nearby and change their settings.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "pi-fig",
  slug: "pi-configurator",
  scheme: "piconfigurator",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: APP_ID,
    // The owner's Apple Developer team, so Xcode signs with it automatically.
    appleTeamId: "4Z3U3P6Q63",
    // Raise for every upload to App Store Connect (TestFlight refuses a repeated build number).
    buildNumber: "4",
    supportsTablet: true,
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: BLUETOOTH_REASON,
      ITSAppUsesNonExemptEncryption: false,
      // Hide expo-dev-menu's floating gear button in dev builds: it sits over the header's right
      // button. The dev menu is still available by shaking the device or pressing Cmd+D.
      EXDevMenuShowFloatingActionButton: false,
      // iPhone stays portrait (`orientation` above). App Store Connect requires iPad apps to
      // support every orientation for multitasking, so iPad gets all four.
      "UISupportedInterfaceOrientations~ipad": [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
    },
  },
  android: {
    package: APP_ID,
    // Raise for every upload to Google Play.
    versionCode: 4,
    adaptiveIcon: {
      backgroundColor: "#FFFFFF",
      foregroundImage: "./assets/android-icon-foreground.png",
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
