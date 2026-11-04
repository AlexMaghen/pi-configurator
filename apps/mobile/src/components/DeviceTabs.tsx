/**
 * The segmented control at the top of an unlocked device's page: "Device & Network" and "Application
 * Settings". Each segment is its own route; switching replaces the current one (no animation, set
 * in the root layout), so Back still returns to the device list. Only the tabs the config gives
 * content to are shown, and with one tab there's no control at all.
 */
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import type { DeviceTab } from "@/lib/form/tabs";
import { useSegmentStyles } from "@/styles/segments";

export type { DeviceTab } from "@/lib/form/tabs";

const TABS: { tab: DeviceTab; label: string }[] = [
  { tab: "device-network", label: "Device & Network" },
  { tab: "app-settings", label: "Application Settings" },
];

export function DeviceTabs({
  id,
  current,
  tabs,
}: {
  id: string;
  current: DeviceTab;
  /** The tabs to offer. */
  tabs: DeviceTab[];
}) {
  const s = useSegmentStyles();
  if (tabs.length < 2) return null;
  return (
    <View style={s.track} accessibilityRole="tablist">
      {TABS.filter(({ tab }) => tabs.includes(tab)).map(({ tab, label }) => {
        const selected = tab === current;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected)
                router.replace({
                  pathname: `/device/[id]/${tab}`,
                  params: { id },
                });
            }}
            style={({ pressed }) => [
              s.segment,
              selected && s.segmentSelected,
              pressed && !selected && s.pressed,
            ]}
          >
            <Text
              style={selected ? s.labelSelected : s.label}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
