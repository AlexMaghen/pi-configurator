/**
 * Device Data: the Pi's report from `system.details` (hardware, operating system, network,
 * Bluetooth, the service), shown as a sheet over the device page. The copy button at the top
 * right puts the whole report on the clipboard as plain text, for support emails and notes.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { DetailSection } from "@pi-configurator/protocol";
import { Banner } from "@/components/Banner";
import { HeaderButton } from "@/components/Button";
import { ProgressNote } from "@/components/ProgressNote";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { detailsText } from "@/lib/format/details";
import { errorMessage } from "@/lib/link/errors";
import { useDevice, useSession, useStore } from "@/lib/session/AppProvider";
import { useLayoutStyles } from "@/styles/layout";

export default function DeviceDataScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const session = useSession(id);
  const device = useDevice(id);
  const l = useLayoutStyles();
  const [sections, setSections] = useState<DetailSection[]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const name = session.info?.name ?? device?.name ?? "Device";

  const fetchDetails = useCallback(
    () =>
      store
        .call(id, "system.details", {})
        .then((result) => {
          setSections(result.sections);
          setError(undefined);
        })
        .catch((err: unknown) => setError(errorMessage(err)))
        .finally(() => setLoading(false)),
    [id, store],
  );

  useEffect(() => {
    void fetchDetails();
  }, [fetchDetails]);

  const refresh = () => {
    setLoading(true);
    void fetchDetails();
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (!sections) return;
    await Clipboard.setStringAsync(detailsText(name, sections));
    setCopied(true);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => <HeaderButton icon="close" label="Close" onPress={() => router.back()} />,
          headerRight: () =>
            sections ? (
              <HeaderButton
                icon={copied ? "check" : "copy"}
                label={copied ? "Copied" : "Copy to clipboard"}
                onPress={() => void copy()}
              />
            ) : null,
        }}
      />
      <Screen refreshControl={<RefreshControl refreshing={loading && !!sections} onRefresh={refresh} />}>
        {!sections && loading ? <ProgressNote text={`Asking ${name}`} /> : null}
        {error ? (
          <Banner tone="error" title="Couldn't read the device data">
            {error}
          </Banner>
        ) : null}
        {copied ? <Banner tone="success">Copied to the clipboard.</Banner> : null}
        {sections?.map((section) => (
          <Section key={section.title} title={section.title}>
            <View style={l.cardBody}>
              {/* One selectable text block per section, so any part can also be copied by hand. */}
              <Text selectable style={l.detailText}>
                {section.items.map((item, i) => (
                  <Text key={item.label}>
                    {i > 0 ? "\n" : ""}
                    <Text style={l.detailLabel}>{item.label}: </Text>
                    {item.value}
                  </Text>
                ))}
              </Text>
            </View>
          </Section>
        ))}
      </Screen>
    </>
  );
}
