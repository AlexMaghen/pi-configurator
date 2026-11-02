/**
 * Devices: pi-configurator devices nearby, found by scanning for the service UUID. Shows each
 * one's name, model and signal; pull down to rescan. Explains Bluetooth-off, permission-denied
 * and no-Bluetooth (Simulator) states. The demo device appears here when it's turned on.
 */
import { useCallback, useMemo, useState } from "react";
import { Linking, RefreshControl, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { Button, HeaderButton } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ListRow } from "@/components/ListRow";
import { ProgressNote } from "@/components/ProgressNote";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { SignalBars } from "@/components/SignalBars";
import { rssiBars } from "@/lib/format/numbers";
import { useAppState, useStore } from "@/lib/session/AppProvider";
import type { DiscoveredDevice, RadioState } from "@/lib/transport/types";
import { useLayoutStyles } from "@/styles/layout";
import { useTheme } from "@/theme";

const RADIO_MESSAGES: Partial<Record<RadioState, { title: string; body: string; settings?: boolean }>> = {
  off: { title: "Bluetooth is off", body: "Turn on Bluetooth in Control Center or Settings to find devices." },
  unauthorized: {
    title: "Bluetooth access is off",
    body: "pi-configurator needs Bluetooth to find your devices. Allow it in Settings.",
    settings: true,
  },
  unsupported: {
    title: "No Bluetooth here",
    body: "This phone (or the Simulator) has no Bluetooth LE radio. Real devices can't be found.",
  },
};

const subtitle = (d: DiscoveredDevice) =>
  [d.model, d.demo ? "Not a real device" : undefined].filter(Boolean).join(" · ") || "pi-configurator device";

export default function DevicesScreen() {
  const store = useStore();
  const { colors } = useTheme();
  const l = useLayoutStyles();
  const devicesById = useAppState((s) => s.devices);
  const radio = useAppState((s) => s.radio);
  const demoEnabled = useAppState((s) => s.demoEnabled);
  const [refreshing, setRefreshing] = useState(false);

  // Scan only while this screen is visible: it costs battery and competes with the connection.
  useFocusEffect(
    useCallback(() => {
      store.startScanning();
      return () => store.stopScanning();
    }, [store]),
  );

  const devices = useMemo(
    () => Object.values(devicesById).sort((a, b) => Number(a.demo) - Number(b.demo) || a.name.localeCompare(b.name)),
    [devicesById],
  );

  const rescan = () => {
    setRefreshing(true);
    store.rescan();
    setTimeout(() => setRefreshing(false), 1200);
  };

  const radioMessage = RADIO_MESSAGES[radio];

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <HeaderButton icon="settings" label="Preferences" onPress={() => router.push("/preferences")} />
          ),
        }}
      />
      <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={rescan} />}>
        {radioMessage ? (
          <Banner
            tone={radio === "unsupported" ? "info" : "warning"}
            title={radioMessage.title}
            action={
              radioMessage.settings ? (
                <Button variant="plain" label="Open Settings" onPress={() => void Linking.openSettings()} />
              ) : undefined
            }
          >
            {radioMessage.body +
              (radio === "unsupported" && !demoEnabled ? " Turn on the demo device in Preferences to try the app." : "")}
          </Banner>
        ) : null}

        {devices.length > 0 ? (
          <Section title="Nearby" footer="Pull down to scan again.">
            {devices.map((d) => (
              <ListRow
                key={d.id}
                title={d.name}
                subtitle={subtitle(d)}
                leading={<SignalBars bars={rssiBars(d.rssi)} label={d.rssi !== undefined ? `Signal ${d.rssi} dBm` : "Signal unknown"} />}
                trailing={d.demo ? <Badge label="Demo" color={colors.demo} background={colors.demoSoft} /> : undefined}
                onPress={() => router.push({ pathname: "/device/[id]/unlock", params: { id: d.id } })}
                accessibilityHint="Opens the device"
              />
            ))}
          </Section>
        ) : radio === "on" ? (
          <View style={l.emptyBlock}>
            <EmptyState icon="bluetooth" title="Looking for devices" body="Make sure the Pi is on and nearby. Its pi-configurator service must be running.">
              <ProgressNote text="Scanning" />
            </EmptyState>
          </View>
        ) : radio === "unsupported" || radio === "off" || radio === "unauthorized" ? (
          <View style={[l.centered, l.emptyBlock]}>
            <EmptyState icon="bluetoothOff" title="No devices" />
          </View>
        ) : (
          <ProgressNote text="Starting Bluetooth" />
        )}
      </Screen>
    </>
  );
}
