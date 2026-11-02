/**
 * Unlock: password entry for one device.
 *
 * - On open, a saved password (Keychain / Keystore) is tried first. If it works the user goes
 *   straight to Settings; if the device says it's wrong, it's forgotten and the form asks.
 * - A password that works is saved for next time. "Forget saved password" removes it.
 * - Wrong password and rate limiting (with a live countdown from `retryAfterS`) show inline.
 * - The SRP math takes a moment on a phone, so each step shows a progress line.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/Button";
import { ProgressNote } from "@/components/ProgressNote";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { TextField } from "@/components/TextField";
import { DEMO_PASSWORD } from "@/lib/demo/demoConfig";
import type { UnlockStep } from "@/lib/link/DeviceLink";
import { formatNumber } from "@/lib/format/numbers";
import { errorMessage, isLinkError } from "@/lib/link/errors";
import { useDevice, useSession, useStore } from "@/lib/session/AppProvider";
import { useLayoutStyles } from "@/styles/layout";
import { useTextStyles } from "@/styles/text";

const STEP_TEXT: Record<UnlockStep, string> = {
  preparing: "Preparing a secure session",
  exchanging: "Talking to the device",
  proving: "Checking the password",
  verifying: "Checking the device",
};

export default function UnlockScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const session = useSession(id);
  const device = useDevice(id);
  const l = useLayoutStyles();
  const t = useTextStyles();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [retryAt, setRetryAt] = useState<number>();
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const autoTried = useRef(false);

  const name = session.info?.name ?? device?.name ?? "Device";
  const isDemo = device?.demo ?? id.startsWith("demo-");

  const openSettings = useCallback(() => {
    router.replace({ pathname: "/device/[id]/settings", params: { id } });
  }, [id]);

  const showError = useCallback((err: unknown) => {
    if (isLinkError(err, "rate_limited")) {
      const wait = err.retryAfterS ?? 30;
      setRetryAt(Date.now() + wait * 1000);
      setError("Too many wrong passwords.");
    } else if (isLinkError(err, "auth_failed")) {
      setError("That password is not right.");
    } else if (isLinkError(err, "verify_failed")) {
      setError("The device couldn't prove it knows the password. It may not be the device you think it is.");
    } else {
      setError(errorMessage(err));
    }
  }, []);

  // First visit: go on if already unlocked, else try the saved password.
  useEffect(() => {
    if (session.phase === "unlocked") {
      openSettings();
      return;
    }
    if (autoTried.current) return;
    autoTried.current = true;
    void (async () => {
      setBusy(true);
      try {
        setHasSaved(await store.hasSavedPassword(id));
        const result = await store.unlockWithSaved(id);
        if (result === "unlocked") return openSettings();
        if (result === "failed") {
          setHasSaved(false);
          setNotice("The saved password no longer works, so it was forgotten. Enter the current one.");
        } else {
          await store.connect(id); // So the name and model from `info` show while typing.
        }
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    })();
  }, [id, openSettings, session.phase, showError, store]);

  // Countdown while rate-limited.
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= retryAt) {
        setRetryAt(undefined);
        setError(undefined);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const started = Date.now();
    try {
      await store.unlock(id, password, { remember: true });
      if (__DEV__) console.log(`[unlock] ${name}: handshake and first load took ${Date.now() - started} ms`);
      setPassword("");
      openSettings();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    await store.forgetPassword(id);
    setHasSaved(false);
    setNotice("Saved password forgotten.");
  };

  const waitS = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const progress =
    session.phase === "connecting"
      ? `Connecting to ${name}`
      : session.unlockStep
        ? STEP_TEXT[session.unlockStep]
        : busy
          ? "Working"
          : undefined;

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <Screen>
        <View style={l.section}>
          <Text style={t.title}>Unlock {name}</Text>
          <Text style={t.muted}>
            {"Enter the device password. It's checked without being sent, and saved on this phone once it works."}
          </Text>
        </View>

        {isDemo ? (
          <Banner tone="info" title="Demo device">
            {`This pretend device runs inside the app. Its password is ${DEMO_PASSWORD}.`}
          </Banner>
        ) : null}
        {session.notice && session.phase !== "unlocked" ? (
          <Banner tone="warning" title="Session ended">
            {session.notice}
          </Banner>
        ) : null}
        {notice ? <Banner tone="info">{notice}</Banner> : null}
        {error ? (
          <Banner tone="error" title={error}>
            {waitS > 0 ? `Try again in ${formatNumber(waitS)} s.` : undefined}
          </Banner>
        ) : null}

        <Section>
          <TextField
            label="Password"
            secure
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
            placeholder="Device password"
          />
        </Section>

        {progress ? <ProgressNote text={progress} /> : null}

        <View style={l.section}>
          <Button
            label={waitS > 0 ? `Wait ${formatNumber(waitS)} s` : "Unlock"}
            icon="lock"
            onPress={() => void submit()}
            disabled={!password || waitS > 0}
            busy={busy}
          />
          {hasSaved ? <Button variant="plain" label="Forget saved password" onPress={() => void forget()} /> : null}
          {session.phase === "closed" && !busy ? (
            <Button
              variant="plain"
              label="Reconnect"
              onPress={() => {
                setError(undefined);
                store.connect(id).catch(showError);
              }}
            />
          ) : null}
        </View>
      </Screen>
    </>
  );
}
