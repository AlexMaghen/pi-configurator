/**
 * Device & Network: the Pi's own settings that the config turns on (Wi-Fi, hostname, time zone),
 * then the device's info and actions. The first page after unlocking when the config has any.
 */
import { useLocalSearchParams } from "expo-router";
import { SettingsForm } from "@/components/SettingsForm";

export default function DeviceNetworkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SettingsForm id={id} tab="device-network" />;
}
