/**
 * Which of the two device tabs a config gives content to. Device & Network shows when
 * `deviceSettings` turns anything on; Application Settings when `appSettings` has a group.
 *
 * The device sections (Device Data, Activity, Disconnect, ...) live on Device & Network, or on
 * Application Settings when Device & Network is hidden. With neither, Application Settings stays
 * so those sections still have a page.
 */
import { hasAppTab, hasDeviceTab, type DeviceSettings, type SettingGroup } from "@pi-configurator/protocol";

export type DeviceTab = "device-network" | "app-settings";

export function deviceTabs(config: { deviceSettings?: DeviceSettings; appSettings?: SettingGroup[] }): DeviceTab[] {
  const tabs: DeviceTab[] = [];
  if (hasDeviceTab(config.deviceSettings)) tabs.push("device-network");
  if (hasAppTab(config.appSettings)) tabs.push("app-settings");
  return tabs.length > 0 ? tabs : ["app-settings"];
}
