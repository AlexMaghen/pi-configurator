/**
 * The segmented control at the top of an unlocked device's page: "Device & Network" and "Application
 * Settings". Each segment is its own route; switching replaces the current one (no animation, set
 * in the root layout), so Back still returns to the device list.
 */
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSegmentStyles } from "@/styles/segments";

export type DeviceTab = "device-network" | "app-settings";

const TABS: { tab: DeviceTab; label: string }[] = [
  { tab: "device-network", label: "Device & Network" },
  { tab: "app-settings", label: "Application Settings" },
];

export function DeviceTabs({
  id,
  current,
}: {
  id: string;
  current: DeviceTab;
}) {
  const s = useSegmentStyles();
  return (
    <View style={s.track} accessibilityRole="tablist">
      {TABS.map(({ tab, label }) => {
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
