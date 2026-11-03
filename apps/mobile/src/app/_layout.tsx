/**
 * Root layout: theme, the app store, and one native stack with every route.
 *
 * Routes (each its own screen, per the owner's rule against one screen switching its UI):
 *   /                                 Devices: nearby devices from the scan
 *   /preferences                      App preferences (demo device switch, about)
 *   /device/[id]/unlock               Password entry; auto-unlocks with a saved password
 *   /device/[id]/device-network       Wi-Fi, hostname, time zone, then device info and actions
 *   /device/[id]/app-settings         The config's own settings (a segment beside device-network)
 *   /device/[id]/choose/[key]         Pick a value for a select field (searchable)
 *   /device/[id]/wifi                 Current connection and the Pi's Wi-Fi scan
 *   /device/[id]/wifi-join            Join one network (or a hidden one)
 *   /device/[id]/details              Device Data: the Pi's hardware / OS / network report (sheet)
 *   /device/[id]/activity             Status events from the Pi
 *   /device/[id]/password             Change the device password
 *   /device/[id]/rename               Change the Bluetooth name
 */
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionGuard } from "@/components/SessionGuard";
import { AppProvider } from "@/lib/session/AppProvider";
import { useTheme } from "@/theme";

export default function RootLayout() {
  const theme = useTheme();
  const base = theme.scheme === "dark" ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.colors.accent,
      background: theme.colors.background,
      card: theme.colors.background,
      text: theme.colors.text,
      border: theme.colors.border,
    },
  };
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
          <SessionGuard />
          <Stack
            screenOptions={{
              headerTintColor: theme.colors.accent,
              headerTitleStyle: { color: theme.colors.text },
              contentStyle: { backgroundColor: theme.colors.background },
              headerBackButtonDisplayMode: "minimal",
            }}
          >
            <Stack.Screen name="index" options={{ title: "Devices", headerLargeTitle: true }} />
            <Stack.Screen name="preferences" options={{ title: "Preferences" }} />
            <Stack.Screen name="device/[id]/unlock" options={{ title: "Unlock" }} />
            {/* The two segments of an unlocked device: switching replaces one with the other. */}
            <Stack.Screen name="device/[id]/device-network" options={{ title: "Device", animation: "none" }} />
            <Stack.Screen name="device/[id]/app-settings" options={{ title: "Device", animation: "none" }} />
            <Stack.Screen name="device/[id]/choose/[key]" options={{ title: "Choose" }} />
            <Stack.Screen name="device/[id]/wifi" options={{ title: "Wi-Fi" }} />
            <Stack.Screen name="device/[id]/wifi-join" options={{ title: "Join network" }} />
            <Stack.Screen name="device/[id]/details" options={{ title: "Device Data", presentation: "modal" }} />
            <Stack.Screen name="device/[id]/activity" options={{ title: "Activity" }} />
            <Stack.Screen name="device/[id]/password" options={{ title: "Change password" }} />
            <Stack.Screen name="device/[id]/rename" options={{ title: "Rename device" }} />
          </Stack>
        </ThemeProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
