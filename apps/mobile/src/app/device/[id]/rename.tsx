/**
 * Rename device (only with `deviceSettings.allowAccessChanges`): sets the Bluetooth name. It has to
 * fit next to the service UUID in the scan response, so it's limited to 29 bytes of UTF-8.
 */
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { BluetoothName, MAX_BLUETOOTH_NAME_BYTES, utf8 } from "@pi-configurator/protocol";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { TextField } from "@/components/TextField";
import { formatNumber } from "@/lib/format/numbers";
import { errorMessage } from "@/lib/link/errors";
import { useSession, useStore } from "@/lib/session/AppProvider";

export default function RenameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const session = useSession(id);
  const [name, setName] = useState(session.info?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const trimmed = name.trim();
  const bytes = utf8(trimmed).length;
  // Same schema the Pi checks access.setName with; the byte count makes the message clearer.
  const problem =
    trimmed === ""
      ? "Enter a name"
      : bytes > MAX_BLUETOOTH_NAME_BYTES
        ? `Too long: ${formatNumber(bytes)} of ${formatNumber(MAX_BLUETOOTH_NAME_BYTES)} bytes`
        : BluetoothName.safeParse(trimmed).error?.issues[0]?.message;

  const submit = async () => {
    if (problem) return;
    setBusy(true);
    setError(undefined);
    try {
      await store.call(id, "access.setName", { name: trimmed });
      store.renamed(id, trimmed);
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {error ? <Banner tone="error" title="Couldn't rename">{error}</Banner> : null}
      <Section footer="The device advertises the new name right away.">
        <TextField
          label="Bluetooth name"
          value={name}
          onChangeText={setName}
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          error={name !== (session.info?.name ?? "") ? problem : undefined}
          help={`Up to ${formatNumber(MAX_BLUETOOTH_NAME_BYTES)} bytes`}
        />
      </Section>
      <Button label="Rename" icon="pencil" onPress={() => void submit()} busy={busy} disabled={!!problem} />
    </Screen>
  );
}
