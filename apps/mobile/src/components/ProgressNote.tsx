/** A spinner with a line of text, for "Connecting", "Checking password" and similar waits. */
import { ActivityIndicator, Text, View } from "react-native";
import { useLayoutStyles } from "@/styles/layout";
import { useTextStyles } from "@/styles/text";

export function ProgressNote({ text }: { text: string }) {
  const l = useLayoutStyles();
  const t = useTextStyles();
  return (
    <View style={l.inline} accessibilityLiveRegion="polite">
      <ActivityIndicator />
      <Text style={t.muted}>{text}</Text>
    </View>
  );
}
