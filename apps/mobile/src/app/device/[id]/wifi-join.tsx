/**
 * Join network: the password for one network from the scan, or name + password for a hidden one.
 * Sends `settings.set` on the wifi field right away (no draft) and shows the Pi's progress
 * ("Connecting to HomeNet", "Connected, IP ...") until it answers.
 *
 * Password rules (protocol): "" means an open network; leaving the password out means "reuse the
 * one the Pi already has saved for this network, else join as open". So an empty field on a
 * secured network is allowed: it rejoins a network the Pi knows.
 *
 * The Wi-Fi password crosses the encrypted session only; it's never shown again or stored here.
 */
import { useState } from "react";
import { View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { validateValue, type WifiValue } from "@pi-configurator/protocol";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { StatusFeed } from "@/components/StatusFeed";
import { TextField } from "@/components/TextField";
import { errorMessage } from "@/lib/link/errors";
import { useSession, useStore } from "@/lib/session/AppProvider";
import { useLayoutStyles } from "@/styles/layout";

export default function WifiJoinScreen() {
  const params = useLocalSearchParams<{ id: string; ssid?: string; security?: string; hidden?: string }>();
  const { id } = params;
  const hidden = params.hidden === "1";
  const open = params.security === "open";
  const store = useStore();
  const session = useSession(id);
  const l = useLayoutStyles();

  const [ssid, setSsid] = useState(params.ssid ?? "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [error, setError] = useState<string>();
  const [joined, setJoined] = useState(false);

  const field = session.fields?.find((f) => f.type === "wifi");
  const value: WifiValue = {
    ssid: ssid.trim(),
    // Open network: say so explicitly. Otherwise an empty field means "use the saved password".
    ...(open && !hidden ? { password: "" } : password !== "" ? { password } : {}),
    ...(hidden ? { hidden: true } : {}),
  };
  const problem = field ? validateValue(field, value) : "This device has no Wi-Fi setting";
  const shownProblem = touched ? problem : undefined;
  const busy = !!session.busy && startedAt !== undefined;
  const entries = startedAt ? session.activity.filter((a) => a.at >= startedAt && a.event.key === field?.key) : [];

  const submit = async () => {
    setTouched(true);
    if (!field || problem) return;
    setError(undefined);
    setStartedAt(Date.now());
    try {
      const outcome = await store.apply(id, { [field.key]: value });
      const failed = outcome.failed[field.key];
      if (failed) setError(failed);
      else {
        setJoined(true);
        setTimeout(() => router.back(), 1200);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const title = hidden ? "Hidden network" : ssid;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen>
        <Section
          footer={
            hidden
              ? "Leave the password empty for an open network, or one the device already knows."
              : open
                ? "This network is open: anyone nearby can see its traffic."
                : "Wi-Fi passwords are 8 to 63 characters. Leave it empty to use the password the device already has saved for this network."
          }
        >
          {hidden ? (
            <TextField
              label="Network name"
              value={ssid}
              onChangeText={setSsid}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="SSID"
              editable={!busy}
            />
          ) : null}
          {!open || hidden ? (
            <TextField
              label="Password"
              secure
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              editable={!busy}
              returnKeyType="join"
              onSubmitEditing={() => void submit()}
              error={shownProblem}
            />
          ) : null}
        </Section>

        {entries.length > 0 ? (
          <Section title="Progress">
            <View style={l.cardBody}>
              <StatusFeed entries={entries} live={busy} />
            </View>
          </Section>
        ) : null}

        {error ? <Banner tone="error" title="Couldn't join">{error}</Banner> : null}
        {joined ? <Banner tone="success" title="Joined">{`The device is on ${value.ssid}.`}</Banner> : null}
        {open && !hidden && shownProblem ? <Banner tone="error">{shownProblem}</Banner> : null}

        <Button label={`Join ${hidden ? "network" : ssid}`} icon="wifi" onPress={() => void submit()} busy={busy} disabled={joined} />
      </Screen>
    </>
  );
}
