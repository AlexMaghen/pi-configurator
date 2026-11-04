/**
 * One settings field, drawn from its description. The control depends on the type:
 *
 *   string           text input (url / email keyboards, multiline), or replace-only when secret
 *   integer, number  numeric input with unit, limits and step; shown with thousands separators
 *   boolean          switch
 *   select           up to MENU_MAX_OPTIONS options: a native drop-down menu on the row;
 *                    more (e.g. time zones): a row that opens the searchable choose screen
 *   wifi             a row that opens the Wi-Fi screen
 *
 * Every field shows its help line, where its value came from (saved / default / the device),
 * inline validation from the shared rules, the Pi's error after a failed save, and "Reset to
 * default" for saved store fields. Read-only fields are shown disabled.
 */
import { MenuView } from "@expo/ui/community/menu";
import { Pressable, Switch, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import type { FormField, ValueState } from "@pi-configurator/protocol";
import {
  currentValue,
  initialText,
  isChange,
  isNumberField,
  isSecretField,
  isStoreField,
  limitsText,
  optionLabel,
  resolveDraft,
  sourceLabel,
  type Draft,
} from "@/lib/form/model";
import { formatNumber, parseNumber } from "@/lib/format/numbers";
import { useFormStyles } from "@/styles/form";
import { useTheme } from "@/theme";
import { Badge } from "./Badge";
import { Icon } from "./Icon";

export interface FieldControlProps {
  field: FormField;
  state: ValueState | undefined;
  draft: Draft | undefined;
  /** The Pi's message from the last save, if it refused this field. */
  saveError?: string;
  onDraft: (draft: Draft | undefined) => void;
  /** select fields: open the choose screen. */
  onChoose: () => void;
  /** wifi fields: open the Wi-Fi screen. */
  onWifi: () => void;
}

/** Select fields with at most this many options use the drop-down menu instead of a page. */
const MENU_MAX_OPTIONS = 10;

/**
 * The keyboard for a text field. Numbers that can't go below zero get the digit-only pads (the
 * decimal pad adds a decimal point); iOS has no pad with a minus sign, so a field that allows
 * negatives (no `min`, or a negative one) gets the numbers-and-punctuation keyboard instead.
 */
function keyboardFor(field: FormField): KeyboardTypeOptions {
  if (field.type === "integer" || field.type === "number") {
    if (field.min === undefined || field.min < 0) return "numbers-and-punctuation";
    return field.type === "integer" ? "number-pad" : "decimal-pad";
  }
  if (field.type === "string" && field.format === "url") return "url";
  if (field.type === "string" && field.format === "email") return "email-address";
  return "default";
}

/** A field's default as display text, when the description has one. */
function defaultText(field: FormField): string | undefined {
  if (!("default" in field) || field.default === undefined) return undefined;
  const d = field.default;
  if (typeof d === "number") return `${formatNumber(d)}${"unit" in field && field.unit ? ` ${field.unit}` : ""}`;
  if (typeof d === "boolean") return d ? "On" : "Off";
  if (typeof d === "string") return d === "" ? "empty" : (optionLabel(field, d) ?? d);
  return undefined;
}

export function FieldControl({ field, state, draft, saveError, onDraft, onChoose, onWifi }: FieldControlProps) {
  const f = useFormStyles();
  const { colors } = useTheme();
  const changed = isChange(field, state, draft);
  const resolved = draft && changed ? resolveDraft(field, draft) : undefined;
  const error = resolved && !resolved.ok ? resolved.error : saveError;
  const readOnly = field.type !== "wifi" && field.readOnly === true;
  // Secret fields never reveal a value, only whether one is set.
  const source = isSecretField(field) && state?.secret ? (state.set ? "Set" : "Not set") : sourceLabel(state);
  const canReset = isStoreField(field) && !readOnly && state?.source === "saved";
  const resetting = draft?.kind === "reset";

  const badge = changed ? (
    <Badge label={resetting ? "Will reset" : "Changed"} color={colors.accent} background={colors.infoSoft} />
  ) : source ? (
    <Badge label={source} />
  ) : null;

  return (
    <View style={f.field}>
      <View style={f.labelRow}>
        <Text style={f.label}>{field.label}</Text>
        {badge}
      </View>

      {renderControl()}

      {field.help ? <Text style={f.help}>{field.help}</Text> : null}
      {isNumberField(field) && limitsText(field) ? <Text style={f.help}>{limitsText(field)}</Text> : null}
      {readOnly ? <Text style={f.help}>Read only</Text> : null}
      {resetting ? <Text style={f.help}>Goes back to the default ({defaultText(field) ?? "none"}) when you save.</Text> : null}
      {error ? (
        <Text style={f.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {canReset || resetting ? (
        <View style={f.fieldActions}>
          <Pressable accessibilityRole="button" onPress={() => onDraft(resetting ? undefined : { kind: "reset" })} hitSlop={6}>
            <Text style={f.fieldAction}>{resetting ? "Undo reset" : "Reset to default"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  function renderControl() {
    switch (field.type) {
      case "wifi": {
        const wifi = state && !state.secret && state.value && typeof state.value === "object" && "connected" in state.value
          ? state.value
          : undefined;
        const text = wifi ? `${wifi.ssid} · ${wifi.connected ? "Connected" : "Not connected"}` : "Not connected";
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`${field.label}: ${text}`} onPress={onWifi} disabled={readOnly}>
            <View style={[f.picker, readOnly && f.inputDisabled]}>
              <Icon name="wifi" color={colors.accent} />
              <Text style={f.pickerText} numberOfLines={1}>
                {text}
              </Text>
              <Icon name="chevronRight" color={colors.textMuted} em={1.1} />
            </View>
          </Pressable>
        );
      }

      case "boolean": {
        const current = currentValue(state);
        const value = draft?.kind === "value" ? draft.value === true : current === true;
        return (
          <View style={f.switchRow}>
            <Text style={f.help}>{value ? "On" : "Off"}</Text>
            <Switch
              value={value}
              disabled={readOnly}
              accessibilityLabel={field.label}
              onValueChange={(on) => onDraft(on === (current === true) ? undefined : { kind: "value", value: on })}
            />
          </View>
        );
      }

      case "select": {
        const value = draft?.kind === "value" ? draft.value : currentValue(state);
        const label = optionLabel(field, value) ?? "Choose";
        const pickerStyle = [f.picker, readOnly && f.inputDisabled, error ? f.inputError : changed ? f.inputChanged : null];
        const options = field.options;
        if (options.length > 0 && options.length <= MENU_MAX_OPTIONS) {
          const saved = currentValue(state);
          const row = (
            <View style={pickerStyle} accessibilityRole="button" accessibilityLabel={`${field.label}: ${label}`}>
              <Text style={f.pickerText} numberOfLines={1}>
                {label}
              </Text>
              <Icon name="chevronDown" color={colors.textMuted} em={1.1} />
            </View>
          );
          if (readOnly) return row;
          return (
            <MenuView
              title={field.label}
              actions={options.map((o) => ({ id: o.value, title: o.label, state: o.value === value ? "on" : "off" }))}
              onPressAction={({ nativeEvent }) =>
                onDraft(nativeEvent.event === saved ? undefined : { kind: "value", value: nativeEvent.event })
              }
            >
              {row}
            </MenuView>
          );
        }
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`${field.label}: ${label}`} onPress={onChoose} disabled={readOnly}>
            <View style={pickerStyle}>
              <Text style={f.pickerText} numberOfLines={1}>
                {label}
              </Text>
              <Icon name="chevronRight" color={colors.textMuted} em={1.1} />
            </View>
          </Pressable>
        );
      }

      case "string":
      case "integer":
      case "number": {
        const secret = isSecretField(field);
        const numeric = isNumberField(field);
        const text = draft?.kind === "text" ? draft.text : resetting ? "" : initialText(field, state);
        const multiline = field.type === "string" && field.format === "multiline";
        const placeholder = secret
          ? state?.secret && state.set
            ? "Type a new value to replace it"
            : "Type a value"
          : resetting
            ? defaultText(field)
            : undefined;
        const input = (
          <TextInput
            value={text}
            editable={!readOnly && !resetting}
            accessibilityLabel={field.label}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            secureTextEntry={secret}
            multiline={multiline}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={keyboardFor(field)}
            onChangeText={(next) => onDraft({ kind: "text", text: next })}
            onBlur={() => {
              // Show numbers with thousands separators again once the user is done typing.
              if (!numeric || draft?.kind !== "text") return;
              const n = parseNumber(draft.text);
              if (n !== undefined && formatNumber(n) !== draft.text) onDraft({ kind: "text", text: formatNumber(n) });
            }}
            style={[
              f.input,
              f.inputFlex,
              multiline && f.inputMultiline,
              (readOnly || resetting) && f.inputDisabled,
              error ? f.inputError : changed ? f.inputChanged : null,
            ]}
          />
        );
        return (
          <View style={f.inputWithUnit}>
            {input}
            {numeric && "unit" in field && field.unit ? <Text style={f.unit}>{field.unit}</Text> : null}
          </View>
        );
      }
    }
  }
}
