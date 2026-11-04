/**
 * The body of both device pages: the device's settings from `settings.describe`, grouped by
 * `group` in first-seen order, under the Device & Network / Application Settings control.
 * `tab` picks the fields: the OS settings (Wi-Fi, hostname, time zone) or the config's own.
 *
 * Edits stay as drafts in the store (so the choose and Wi-Fi screens, and the other tab, can add
 * to them) until Save, which sends every changed field with `settings.set`, whichever tab it's
 * on. While saving, the Pi's status events show live; afterwards each refused field shows the
 * Pi's message. `children` render below the settings (the device sections on Device & Network).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button, HeaderButton } from "@/components/Button";
import { DeviceTabs, type DeviceTab } from "@/components/DeviceTabs";
import { FieldControl } from "@/components/FieldControl";
import { ProgressNote } from "@/components/ProgressNote";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { StatusFeed } from "@/components/StatusFeed";
import { groupFields, isSystemField, pendingChanges } from "@/lib/form/model";
import { formatNumber } from "@/lib/format/numbers";
import { errorMessage } from "@/lib/link/errors";
import { useDevice, useSession, useStore } from "@/lib/session/AppProvider";
import type { SaveOutcome } from "@/lib/session/AppStore";
import { useFormStyles } from "@/styles/form";
import { useLayoutStyles } from "@/styles/layout";

export interface SettingsFormProps {
  id: string;
  tab: DeviceTab;
  /** Shown when this tab has no settings (null hides the note). */
  emptyText: string | null;
  children?: ReactNode;
}

export function SettingsForm({ id, tab, emptyText, children }: SettingsFormProps) {
  const store = useStore();
  const session = useSession(id);
  const device = useDevice(id);
  const l = useLayoutStyles();
  const f = useFormStyles();
  const [outcome, setOutcome] = useState<SaveOutcome>();
  const [failure, setFailure] = useState<string>();
  const [saveStartedAt, setSaveStartedAt] = useState<number>();

  const { fields, values = {}, drafts, saveErrors, busy, info, description } = session;

  // Normally loaded by unlock; load here when arriving another way.
  useEffect(() => {
    if (session.phase === "unlocked" && !fields) store.load(id).catch((err) => setFailure(errorMessage(err)));
  }, [fields, id, session.phase, store]);

  const shown = useMemo(
    () => (fields ?? []).filter((f) => isSystemField(f) === (tab === "device-network")),
    [fields, tab],
  );
  const groups = useMemo(() => groupFields(shown), [shown]);
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
        <DeviceTabs id={id} current={tab} />

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
          <Section key={group.title ?? "_ungrouped"} title={group.title}>
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

        {fields && shown.length === 0 && emptyText ? <Text style={l.sectionFooter}>{emptyText}</Text> : null}

        {children}
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
