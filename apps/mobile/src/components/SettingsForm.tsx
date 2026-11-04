/**
 * The body of both device pages, under the Device & Network / Application Settings control.
 * Device & Network shows the Pi's own settings that `deviceSettings` turns on (Wi-Fi, hostname,
 * time zone, in that order); Application Settings shows the `appSettings` groups, each under its
 * name and help, in the config's order. A tab with nothing on it is hidden (see lib/form/tabs).
 *
 * Edits stay as drafts in the store (so the choose and Wi-Fi screens, and the other tab, can add
 * to them) until Save, which sends every changed field with `settings.set`, whichever tab it's
 * on. While saving, the Pi's status events show live; afterwards each refused field shows the
 * Pi's message. The device sections (DeviceSections) render below the settings on whichever tab
 * holds them.
 */
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button, HeaderButton } from "@/components/Button";
import { DeviceSections } from "@/components/DeviceSections";
import { DeviceTabs } from "@/components/DeviceTabs";
import { FieldControl } from "@/components/FieldControl";
import { ProgressNote } from "@/components/ProgressNote";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { StatusFeed } from "@/components/StatusFeed";
import { isSystemField, pendingChanges } from "@/lib/form/model";
import { deviceTabs, type DeviceTab } from "@/lib/form/tabs";
import { formatNumber } from "@/lib/format/numbers";
import { errorMessage } from "@/lib/link/errors";
import { useDevice, useSession, useStore } from "@/lib/session/AppProvider";
import type { SaveOutcome } from "@/lib/session/AppStore";
import type { FormField } from "@pi-configurator/protocol";
import { useFormStyles } from "@/styles/form";
import { useLayoutStyles } from "@/styles/layout";

export interface SettingsFormProps {
  id: string;
  tab: DeviceTab;
}

/** One heading and its fields. Device & Network has one fixed "Network" heading. */
interface FormGroup {
  title?: string;
  help?: string;
  fields: FormField[];
}

export function SettingsForm({ id, tab }: SettingsFormProps) {
  const store = useStore();
  const session = useSession(id);
  const device = useDevice(id);
  const l = useLayoutStyles();
  const f = useFormStyles();
  const [outcome, setOutcome] = useState<SaveOutcome>();
  const [failure, setFailure] = useState<string>();
  const [saveStartedAt, setSaveStartedAt] = useState<number>();

  const { fields, values = {}, drafts, saveErrors, busy, info, description, deviceSettings, appSettings } = session;

  // Normally loaded by unlock; load here when arriving another way.
  useEffect(() => {
    if (session.phase === "unlocked" && !fields) store.load(id).catch((err) => setFailure(errorMessage(err)));
  }, [fields, id, session.phase, store]);

  const tabs = useMemo(() => deviceTabs({ deviceSettings, appSettings }), [deviceSettings, appSettings]);
  // A config can hide this tab (e.g. a link to Device & Network on a device with none): go to one it shows.
  useEffect(() => {
    if (fields && !tabs.includes(tab)) router.replace({ pathname: `/device/[id]/${tabs[0]!}`, params: { id } });
  }, [fields, id, tab, tabs]);
  const groups = useMemo((): FormGroup[] => {
    if (!fields) return [];
    if (tab === "device-network") {
      const own = fields.filter(isSystemField);
      return own.length > 0 ? [{ title: "Network", fields: own }] : [];
    }
    return (appSettings ?? []).map((g) => ({ title: g.groupName, help: g.help, fields: g.items }));
  }, [appSettings, fields, tab]);
  // On Device & Network, or on Application Settings when Device & Network is hidden.
  const showsDeviceSections = tab === (tabs.includes("device-network") ? "device-network" : "app-settings");
  // Counts changes on both tabs: Save sends them all.
  const pending = useMemo(() => pendingChanges(fields ?? [], values, drafts), [fields, values, drafts]);
  const hasErrors = Object.keys(pending.errors).length > 0;
  const liveEntries = saveStartedAt ? session.activity.filter((a) => a.at >= saveStartedAt) : [];

  const save = async () => {
    setOutcome(undefined);
    setFailure(undefined);
    setSaveStartedAt(Date.now());
    try {
      setOutcome(await store.save(id));
    } catch (err) {
      setFailure(errorMessage(err));
    }
  };

  const failedCount = outcome ? Object.keys(outcome.failed).length : 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: info?.name ?? device?.name ?? "Device",
          headerTitleStyle: f.deviceTitle,
          // Leaving is the X on the right, back to the device list (the session stays open
          // until Disconnect or the idle timeout, as before).
          headerBackVisible: false,
          headerRight: () => (
            <HeaderButton icon="closeCircle" label="Close device" onPress={() => router.dismissAll()} />
          ),
        }}
      />
      <Screen
        actions={
          pending.count > 0 || busy ? (
            <>
              <Button
                variant="secondary"
                label="Discard"
                onPress={() => {
                  store.discardDrafts(id);
                  setOutcome(undefined);
                }}
                disabled={!!busy}
              />
              <Button
                grow
                label={`Save ${formatNumber(pending.count)} ${pending.count === 1 ? "change" : "changes"}`}
                onPress={() => void save()}
                disabled={hasErrors || pending.count === 0}
                busy={!!busy}
              />
            </>
          ) : undefined
        }
      >
        {description ? <Text style={f.deviceDescription}>{description}</Text> : null}
        {fields ? <DeviceTabs id={id} current={tab} tabs={tabs} /> : null}

        {!fields ? <ProgressNote text="Loading settings" /> : null}

        {failure ? <Banner tone="error" title="Couldn't save">{failure}</Banner> : null}
        {outcome && !busy ? (
          failedCount > 0 ? (
            <Banner tone="error" title={`${formatNumber(failedCount)} ${failedCount === 1 ? "setting wasn't" : "settings weren't"} saved`}>
              {"The device's reasons are shown under each setting."}
            </Banner>
          ) : (
            <Banner tone="success" title="Saved">
              {savedSummary(outcome)}
            </Banner>
          )
        ) : null}

        {liveEntries.length > 0 || busy ? (
          <Section title={busy ? "Applying" : "Last save"}>
            <View style={l.cardBody}>
              {liveEntries.length > 0 ? <StatusFeed entries={liveEntries} live={!!busy} /> : <ProgressNote text="Sending" />}
            </View>
          </Section>
        ) : null}

        {groups.map((group) => (
          <Section key={group.title ?? "_ungrouped"} title={group.title} description={group.help}>
            {group.fields.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                state={values[field.key]}
                draft={drafts[field.key]}
                saveError={saveErrors[field.key]}
                onDraft={(draft) => store.setDraft(id, field.key, draft)}
                onChoose={() =>
                  router.push({ pathname: "/device/[id]/choose/[key]", params: { id, key: field.key } })
                }
                onWifi={() => router.push({ pathname: "/device/[id]/wifi", params: { id } })}
              />
            ))}
          </Section>
        ))}

        {fields && groups.length === 0 ? (
          <Text style={l.sectionFooter}>{"This device's config file turns on no settings."}</Text>
        ) : null}

        {fields && showsDeviceSections ? <DeviceSections id={id} /> : null}
      </Screen>
    </>
  );
}

/** "Restarted a.service. Reloaded b.service." or, when neither, that the device has the settings. */
function savedSummary({ restarted, reloaded }: SaveOutcome): string {
  const parts = [
    restarted.length > 0 ? `Restarted ${restarted.join(", ")}.` : "",
    reloaded.length > 0 ? `Reloaded ${reloaded.join(", ")}.` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "The device has the new settings.";
}
