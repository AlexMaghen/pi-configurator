/** The app's button: primary / secondary / danger / plain, with an optional icon and busy state. */
import { ActivityIndicator, Pressable, Text } from "react-native";
import { useButtonStyles } from "@/styles/buttons";
import { useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "plain";
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  /** Fill the remaining width in a row. */
  grow?: boolean;
}

export function Button({ label, onPress, variant = "primary", icon, disabled, busy, grow }: ButtonProps) {
  const s = useButtonStyles();
  const { colors } = useTheme();
  const textColor = {
    primary: colors.onAccent,
    secondary: colors.text,
    danger: "#FFFFFF",
    plain: colors.accent,
  }[variant];
  const labelStyle = {
    primary: s.labelPrimary,
    secondary: s.labelSecondary,
    danger: s.labelDanger,
    plain: s.labelPlain,
  }[variant];
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [s.base, s[variant], grow && s.grow, pressed && s.pressed, disabled && s.disabled]}
    >
      {busy ? <ActivityIndicator color={textColor} /> : icon ? <Icon name={icon} color={textColor} em={1.1} /> : null}
      <Text style={[s.label, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

/** Icon-only button for navigation headers. */
export function HeaderButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const s = useButtonStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [s.headerIcon, pressed && s.pressed]}
    >
      <Icon name={icon} color={colors.accent} em={1.4} />
    </Pressable>
  );
}
