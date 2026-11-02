/**
 * Settings: the device's form, built from `settings.describe` and grouped by `group` in
 * first-seen order. Edits stay as drafts in the store (so the choose and Wi-Fi screens can
 * add to them) until Save, which sends only changed fields with `settings.set`. While saving,
 * the Pi's status events show live; afterwards each refused field shows the Pi's message.
 */
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button, HeaderButton } from "@/components/Button";
import { FieldControl } from "@/components/FieldControl";
import { ProgressNote } from "@/components/ProgressNote";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { StatusFeed } from "@/components/StatusFeed";
import { groupFields, pendingChanges } from "@/lib/form/model";
import { formatNumber } from "@/lib/format/numbers";
import { errorMessage } from "@/lib/link/errors";
import { useSession, useStore } from "@/lib/session/AppProvider";
import type { SaveOutcome } from "@/lib/session/AppStore";
import { useLayoutStyles } from "@/styles/layout";

export default function SettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const session = useSession(id);
  const l = useLayoutStyles();
  const [outcome, setOutcome] = useState<SaveOutcome>();
  const [failure, setFailure] = useState<string>();
  const [saveStartedAt, setSaveStartedAt] = useState<number>();

  const { fields, values = {}, drafts, saveErrors, busy, info } = session;

  // Normally loaded by unlock; load here when arriving another way.
  useEffect(() => {
    if (session.phase === "unlocked" && !fields) store.load(id).catch((err) => setFailure(errorMessage(err)));
  }, [fields, id, session.phase, store]);

  const groups = useMemo(() => groupFields(fields ?? []), [fields]);
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
          title: info?.name ?? "Settings",
          headerRight: () => (
            <HeaderButton
              icon="more"
              label="Device menu"
              onPress={() => router.push({ pathname: "/device/[id]/menu", params: { id } })}
            />
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
        {!fields ? <ProgressNote text="Loading settings" /> : null}

        {failure ? <Banner tone="error" title="Couldn't save">{failure}</Banner> : null}
        {outcome && !busy ? (
          failedCount > 0 ? (
            <Banner tone="error" title={`${formatNumber(failedCount)} ${failedCount === 1 ? "setting wasn't" : "settings weren't"} saved`}>
              {"The device's reasons are shown under each setting."}
            </Banner>
          ) : (
            <Banner tone="success" title="Saved">
              {outcome.restarted.length > 0 ? `Restarted ${outcome.restarted.join(", ")}.` : "The device has the new settings."}
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

        {fields && fields.length === 0 ? (
          <Text style={l.sectionFooter}>This device has no settings in its config file.</Text>
        ) : null}
      </Screen>
    </>
  );
}
