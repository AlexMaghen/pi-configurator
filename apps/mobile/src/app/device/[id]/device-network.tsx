/**
 * Device & Network: the OS settings (Wi-Fi, hostname, time zone), then the device's info and
 * actions. The first page after unlocking; Application Settings is the other segment.
 */
import { useLocalSearchParams } from "expo-router";
import { DeviceSections } from "@/components/DeviceSections";
import { SettingsForm } from "@/components/SettingsForm";

export default function DeviceNetworkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SettingsForm id={id} tab="device-network" emptyText={null}>
      <DeviceSections id={id} />
    </SettingsForm>
  );
}
