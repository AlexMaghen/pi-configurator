/**
 * Change password (only with `deviceSettings.allowAccessChanges`). The new password goes through
 * the encrypted session; the Pi rewrites its config and ends every other session. This phone's
 * saved password is updated so auto-unlock keeps working.
 */
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { TextField } from "@/components/TextField";
import { errorMessage } from "@/lib/link/errors";
import { useStore } from "@/lib/session/AppProvider";

/** The protocol allows 1 to 128 characters; the app asks for at least 8, like the Pi's own warning. */
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

export default function ChangePasswordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const problem =
    password.length < MIN_LENGTH
      ? `Use at least ${MIN_LENGTH} characters`
      : password.length > MAX_LENGTH
        ? `Use at most ${MAX_LENGTH} characters`
        : undefined;
  const mismatch = confirm !== password ? "The passwords don't match" : undefined;

  const submit = async () => {
    setTouched(true);
    if (problem || mismatch) return;
    setBusy(true);
    setError(undefined);
    try {
      await store.call(id, "access.setPassword", { password });
      await store.rememberPassword(id, password).catch(() => undefined);
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {error ? <Banner tone="error" title="Couldn't change the password">{error}</Banner> : null}
      <Section footer="Other phones will need the new password. This phone remembers it.">
        <TextField
          label="New password"
          secure
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          error={touched ? problem : undefined}
        />
        <TextField
          label="Confirm"
          secure
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          error={touched ? mismatch : undefined}
        />
      </Section>
      <Button label="Change password" icon="key" onPress={() => void submit()} busy={busy} />
    </Screen>
  );
}
