/**
 * Wi-Fi: the Pi's current connection (from settings.get on the wifi field) and the networks its
 * own radio sees (wifi.scan; iOS can't list Wi-Fi networks itself). Tapping a network opens the
 * join screen; "Other network" joins a hidden one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { WifiNetwork } from "@pi-configurator/protocol";
import { Banner } from "@/components/Banner";
import { HeaderButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ListRow } from "@/components/ListRow";
import { ProgressNote } from "@/components/ProgressNote";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { SignalBars } from "@/components/SignalBars";
import { percentBars } from "@/lib/format/numbers";
import { errorMessage } from "@/lib/link/errors";
import { useSession, useStore } from "@/lib/session/AppProvider";
import { useTheme } from "@/theme";

const SECURITY_LABEL: Record<WifiNetwork["security"], string> = {
  open: "Open",
  wep: "WEP",
  wpa: "WPA",
  wpa2: "WPA2",
  wpa3: "WPA3",
  enterprise: "Enterprise",
};

export default function WifiScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const session = useSession(id);
  const { colors } = useTheme();
  const [networks, setNetworks] = useState<WifiNetwork[]>();
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string>();

  const field = session.fields?.find((f) => f.type === "wifi");
  const state = field ? session.values?.[field.key] : undefined;
  const current = state && !state.secret && state.value && typeof state.value === "object" && "connected" in state.value
    ? state.value
    : undefined;

  /** Asks the Pi's radio for networks. Sets state only after awaiting, so effects can call it. */
  const runScan = useCallback(async () => {
    try {
      const result = await store.call(id, "wifi.scan", {});
      setNetworks(result.networks);
      setError(undefined);
      if (field) await store.refreshValues(id, [field.key]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setScanning(false);
    }
  }, [field, id, store]);

  const scan = () => {
    setScanning(true);
    void runScan();
  };

  // Scan once on open; the header button and pull-down scan again.
  // runScan only sets state after its first await, which this rule can't see.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (field) void runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.key]);

  // The scan's `inUse` goes stale after a join, so "connected" follows the current connection.
  const connectedSsid = current?.connected ? current.ssid : undefined;

  // Connected first, then strongest; one row per SSID (several access points can share a name).
  const sorted = useMemo(() => {
    const best = new Map<string, WifiNetwork>();
    for (const n of networks ?? []) {
      if (!n.ssid) continue;
      const seen = best.get(n.ssid);
      if (!seen || n.signal > seen.signal) best.set(n.ssid, { ...n, inUse: n.ssid === connectedSsid });
    }
    return [...best.values()].sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal);
  }, [networks, connectedSsid]);

  const join = (params: { ssid?: string; security?: string; hidden?: string }) =>
    router.push({ pathname: "/device/[id]/wifi-join", params: { id, ...params } });

  if (!field) {
    return (
      <Screen>
        <Banner tone="info" title="No Wi-Fi setting">
          {"This device's config has no Wi-Fi field."}
        </Banner>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: field.label,
          headerRight: () => <HeaderButton icon="refresh" label="Scan again" onPress={scan} />,
        }}
      />
      <Screen refreshControl={<RefreshControl refreshing={false} onRefresh={scan} />}>
        <Section title="Current connection">
          {current ? (
            <ListRow
              title={current.ssid}
              subtitle={[current.connected ? "Connected" : "Not connected", current.ipv4 ? `IP ${current.ipv4}` : undefined]
                .filter(Boolean)
                .join(" · ")}
              leading={<SignalBars bars={percentBars(current.signal)} label={`Signal ${current.signal ?? 0} %`} />}
              trailing={current.connected ? <Icon name="check" color={colors.success} /> : undefined}
            />
          ) : (
            <ListRow title="Not connected" icon="wifi" />
          )}
        </Section>

        {error ? <Banner tone="error" title="Scan failed">{error}</Banner> : null}

        <Section title="Networks the device can see" footer="The list comes from the device's own Wi-Fi radio.">
          {scanning && !networks ? <ListRow title="Scanning" leading={<ProgressNote text="" />} /> : null}
          {sorted.map((n) => (
            <ListRow
              key={n.ssid}
              title={n.ssid}
              subtitle={[SECURITY_LABEL[n.security], n.inUse ? "Connected" : undefined].filter(Boolean).join(" · ")}
              leading={<SignalBars bars={percentBars(n.signal)} label={`Signal ${n.signal} %`} />}
              trailing={n.security !== "open" ? <Icon name="lock" color={colors.textMuted} em={1} accessibilityLabel="Secured" /> : undefined}
              onPress={() => join({ ssid: n.ssid, security: n.security })}
            />
          ))}
          <ListRow title="Other network" subtitle="Join a hidden network by name" icon="plus" onPress={() => join({ hidden: "1" })} />
        </Section>
      </Screen>
    </>
  );
}
