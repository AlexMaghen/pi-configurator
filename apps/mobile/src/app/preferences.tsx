/** App preferences: the demo device switch and version info. */
import { Switch } from "react-native";
import Constants from "expo-constants";
import { PROTOCOL_VERSION } from "@pi-configurator/protocol";
import { ListRow } from "@/components/ListRow";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { useAppState, useStore } from "@/lib/session/AppProvider";
import { preferences } from "@/lib/platform/secureStorage";

export default function PreferencesScreen() {
  const store = useStore();
  const demoEnabled = useAppState((s) => s.demoEnabled);
  const toggle = (on: boolean) => {
    store.setDemoEnabled(on);
    void preferences.setShowDemoDevice(on);
  };
  return (
    <Screen>
      <Section
        title="Demo"
        footer="Adds a pretend BallsPi to the device list. It runs inside the app and needs no Bluetooth, so you can try every screen without a Raspberry Pi."
      >
        <ListRow
          title="Show demo device"
          icon="cpu"
          trailing={<Switch value={demoEnabled} onValueChange={toggle} accessibilityLabel="Show demo device" />}
        />
      </Section>
      <Section title="About">
        <ListRow title="App version" value={Constants.expoConfig?.version ?? "dev"} />
        <ListRow title="Protocol version" value={String(PROTOCOL_VERSION)} />
        <ListRow title="Build" value={__DEV__ ? "Development" : "Release"} />
      </Section>
    </Screen>
  );
}
