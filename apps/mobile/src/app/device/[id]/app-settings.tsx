/**
 * Application Settings: the config's `appSettings` groups. Also holds the device's info and
 * actions when the config hides Device & Network.
 */
import { useLocalSearchParams } from "expo-router";
import { SettingsForm } from "@/components/SettingsForm";

export default function AppSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SettingsForm id={id} tab="app-settings" />;
}
