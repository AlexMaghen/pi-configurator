/** An inline message box: info, warning, error or success, with a matching SVG icon. */
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { createStyles, useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";

type Tone = "info" | "warning" | "error" | "success";

const useStyles = createStyles((t) => ({
  banner: {
    flexDirection: "row",
    gap: t.space.md,
    padding: t.space.md,
    borderRadius: t.radius.md,
    alignItems: "flex-start",
  },

  text: { flex: 1, gap: t.space.xs },
  title: { fontSize: t.fontSize.label, fontWeight: t.fontWeight.semibold, color: t.colors.text },
  body: { fontSize: t.fontSize.small, color: t.colors.text, lineHeight: 18 },
}));

const ICONS: Record<Tone, IconName> = { info: "info", warning: "alert", error: "alert", success: "check" };

export interface BannerProps {
  tone?: Tone;
  title?: string;
  /** Body text (a string) or custom content. */
  children?: ReactNode;
  /** A button under the text, e.g. "Open Settings". */
  action?: ReactNode;
}

export function Banner({ tone = "info", title, children, action }: BannerProps) {
  const s = useStyles();
  const { colors } = useTheme();
  const palette = {
    info: { bg: colors.infoSoft, fg: colors.accent },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    error: { bg: colors.dangerSoft, fg: colors.danger },
    success: { bg: colors.successSoft, fg: colors.success },
  }[tone];
  return (
    <View
      style={StyleSheet.flatten([s.banner, { backgroundColor: palette.bg }])}
      accessibilityRole={tone === "error" ? "alert" : undefined}
    >
      <Icon name={ICONS[tone]} color={palette.fg} fontSize={15} />
      <View style={s.text}>
        {title ? <Text style={s.title}>{title}</Text> : null}
        {typeof children === "string" ? <Text style={s.body}>{children}</Text> : children}
        {action}
      </View>
    </View>
  );
}
