/** Application Settings: the settings the device's config file defines for its own software. */
import { useLocalSearchParams } from "expo-router";
import { SettingsForm } from "@/components/SettingsForm";

export default function AppSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SettingsForm id={id} tab="app-settings" emptyText="This device's config file has no application settings." />
  );
}
