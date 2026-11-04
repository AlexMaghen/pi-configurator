/**
 * The device part of the device page, under the settings (on Device & Network, or on Application
 * Settings when the config hides Device & Network): what the device reported about itself, and
 * the actions its config allows. Reboot needs `deviceSettings.allowReboot`; Change password and
 * Rename need `deviceSettings.allowAccessChanges`. Hidden controls are refused by the Pi anyway.
 */
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { Badge } from "@/components/Badge";
import { Banner } from "@/components/Banner";
import { ListRow } from "@/components/ListRow";
import { Section } from "@/components/Section";
import { errorMessage } from "@/lib/link/errors";
import { useDevice, useSession, useStore } from "@/lib/session/AppProvider";
import { useTheme } from "@/theme";

export function DeviceSections({ id }: { id: string }) {
  const store = useStore();
  const session = useSession(id);
  const device = useDevice(id);
  const { colors } = useTheme();
  const [hasSaved, setHasSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [rebooting, setRebooting] = useState(false);

  useEffect(() => {
    void store.hasSavedPassword(id).then(setHasSaved);
  }, [id, store]);

  const { info, deviceSettings: permissions } = session;
  const name = info?.name ?? device?.name ?? "Device";
  const go = (
    pathname: "/device/[id]/details" | "/device/[id]/activity" | "/device/[id]/password" | "/device/[id]/rename",
  ) =>
    router.push({ pathname, params: { id } });

  const reboot = () =>
    Alert.alert(`Reboot ${name}?`, "The device restarts and the app disconnects. It's usually back within a minute.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reboot",
        style: "destructive",
        onPress: async () => {
          setRebooting(true);
          try {
            await store.call(id, "system.reboot", {});
            router.dismissAll();
          } catch (err) {
            setRebooting(false);
            setError(errorMessage(err));
          }
        },
      },
    ]);

  const disconnect = async () => {
    router.dismissAll();
    await store.disconnect(id);
  };

  const forget = async () => {
    await store.forgetPassword(id);
    setHasSaved(false);
  };

  return (
    <>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Section title="Device">
        {device?.demo ? (
          <ListRow title="Demo device" trailing={<Badge label="Demo" color={colors.demo} background={colors.demoSoft} />} />
        ) : null}
        {info?.model ? <ListRow title="Model" value={info.model} /> : null}
        <ListRow title="Device Data" icon="info" onPress={() => go("/device/[id]/details")} />
        <ListRow title="Service version" value={info?.serviceVersion ?? "Unknown"} />
        <ListRow title="Protocol" value={info ? String(info.protocol) : "Unknown"} />
        <ListRow title="Activity" icon="activity" onPress={() => go("/device/[id]/activity")} />
      </Section>

      {permissions?.allowAccessChanges ? (
        <Section title="Access" footer="Changing the password ends every other phone's session.">
          <ListRow title="Change password" icon="key" onPress={() => go("/device/[id]/password")} />
          <ListRow title="Rename device" icon="pencil" onPress={() => go("/device/[id]/rename")} />
        </Section>
      ) : null}

      {permissions?.allowReboot ? (
        <Section>
          <ListRow title={rebooting ? "Rebooting" : "Reboot"} icon="power" danger disabled={rebooting} onPress={reboot} chevron={false} />
        </Section>
      ) : null}

      <Section title="This phone">
        {hasSaved ? (
          <ListRow title="Forget saved password" icon="trash" onPress={() => void forget()} chevron={false} />
        ) : null}
        <ListRow title="Disconnect" icon="logout" onPress={() => void disconnect()} chevron={false} />
      </Section>
    </>
  );
}
