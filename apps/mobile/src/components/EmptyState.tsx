/** Centered icon, title and explanation for empty lists and unavailable states. */
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useLayoutStyles } from "@/styles/layout";
import { useTextStyles } from "@/styles/text";
import { useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";

export function EmptyState({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  const l = useLayoutStyles();
  const t = useTextStyles();
  const { colors } = useTheme();
  return (
    <View style={l.centered}>
      <Icon name={icon} color={colors.textMuted} em={2.5} strokeWidth={1.5} />
      <Text style={[t.title, t.center]}>{title}</Text>
      {body ? <Text style={[t.muted, t.center]}>{body}</Text> : null}
      {children}
    </View>
  );
}
