/**
 * A row inside a `Section`: optional leading icon, title and subtitle, a value or custom
 * trailing element, and a chevron when it navigates.
 */
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useLayoutStyles } from "@/styles/layout";
import { useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";

export interface ListRowProps {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Shows a chevron; defaults to true when `onPress` is set. */
  chevron?: boolean;
  danger?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

export function ListRow(props: ListRowProps) {
  const { title, subtitle, value, icon, leading, trailing, onPress, danger, disabled, accessibilityHint } = props;
  const s = useLayoutStyles();
  const { colors } = useTheme();
  const chevron = props.chevron ?? onPress !== undefined;
  const content = (pressed: boolean) => (
    <View style={[s.row, pressed && s.rowPressed]}>
      {leading ?? (icon ? <Icon name={icon} color={danger ? colors.danger : colors.accent} /> : null)}
      <View style={s.rowText}>
        <Text style={danger ? s.rowTitleDanger : s.rowTitle}>{title}</Text>
        {subtitle ? <Text style={s.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={s.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? <Icon name="chevronRight" color={colors.textMuted} em={1.1} /> : null}
    </View>
  );
  if (!onPress) return content(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}
