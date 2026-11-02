/**
 * A labeled text input with help and error lines. Secure inputs get a show/hide toggle.
 * Used by the stand-alone forms (unlock, Wi-Fi join, password, rename); the settings form
 * uses the same styles through FieldControl.
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { useFormStyles } from "@/styles/form";
import { useLayoutStyles } from "@/styles/layout";
import { useTheme } from "@/theme";
import { Icon } from "./Icon";

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  help?: string;
  error?: string;
  /** Hidden text with a reveal toggle. */
  secure?: boolean;
}

export function TextField({ label, help, error, secure, editable = true, ...input }: TextFieldProps) {
  const f = useFormStyles();
  const l = useLayoutStyles();
  const { colors } = useTheme();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={f.field}>
      <Text style={f.label}>{label}</Text>
      <View style={l.inline}>
        <TextInput
          {...input}
          editable={editable}
          accessibilityLabel={label}
          secureTextEntry={secure && !revealed}
          placeholderTextColor={colors.textMuted}
          style={[f.input, f.inputFlex, !editable && f.inputDisabled, error ? f.inputError : null]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide" : "Show"}
            hitSlop={10}
            onPress={() => setRevealed((r) => !r)}
          >
            <Icon name={revealed ? "eyeOff" : "eye"} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={f.error}>{error}</Text> : help ? <Text style={f.help}>{help}</Text> : null}
    </View>
  );
}
