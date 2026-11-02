/**
 * Choose: a searchable list for one select field. Picking a value stores it as a draft and goes
 * back to Settings, where Save sends it.
 *
 * Timezone fields come with the Pi's full zone list as options, so search matters there. If a
 * device ever sends one without options, this screen falls back to the phone's own zones and also
 * offers whatever the user typed; the Pi checks it on save.
 */
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/components/Icon";
import { currentValue } from "@/lib/form/model";
import { looksLikeTimezone, timezoneChoices } from "@/lib/form/timezones";
import { useSession, useStore } from "@/lib/session/AppProvider";
import { useFormStyles } from "@/styles/form";
import { useLayoutStyles } from "@/styles/layout";
import { useTextStyles } from "@/styles/text";
import { useTheme } from "@/theme";

interface Choice {
  value: string;
  label: string;
  /** A typed value not in the list. */
  custom?: boolean;
}

export default function ChooseScreen() {
  const { id, key } = useLocalSearchParams<{ id: string; key: string }>();
  const store = useStore();
  const session = useSession(id);
  const l = useLayoutStyles();
  const f = useFormStyles();
  const t = useTextStyles();
  const { colors } = useTheme();
  const [query, setQuery] = useState("");

  const field = session.fields?.find((x) => x.key === key);
  const draft = session.drafts[key];
  const saved = currentValue(session.values?.[key]);
  const selected = draft?.kind === "value" ? draft.value : saved;
  const fromPhone = field?.type === "select" && !field.options;

  const all: Choice[] = useMemo(() => {
    if (field?.type !== "select") return [];
    if (field.options) return field.options;
    return timezoneChoices().map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [field]);

  const choices = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? all.filter((c) => c.label.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)) : all;
    const typed = query.trim();
    if (fromPhone && typed && looksLikeTimezone(typed) && !all.some((c) => c.value === typed)) {
      return [{ value: typed, label: `Use "${typed}"`, custom: true }, ...matches];
    }
    return matches;
  }, [all, fromPhone, query]);

  if (!field || field.type !== "select") {
    return (
      <View style={l.centered}>
        <Text style={t.muted}>{"This setting isn't available."}</Text>
      </View>
    );
  }

  const pick = (value: string) => {
    store.setDraft(id, key, value === saved ? undefined : { kind: "value", value });
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: field.label }} />
      <FlatList
        style={l.screen}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        data={choices}
        keyExtractor={(c) => (c.custom ? `custom:${c.value}` : c.value)}
        ListHeaderComponent={
          <View style={l.listHeaderBody}>
            <View style={f.picker}>
              <Icon name="search" color={colors.textMuted} em={1.1} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                accessibilityLabel={`Search ${field.label}`}
                style={f.pickerText}
              />
            </View>
            {fromPhone ? (
              <Text style={f.help}>
                The list comes from this phone. You can also type any time zone name; the device checks it when you save.
              </Text>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={l.dividerTrack}>
            <View style={l.divider} />
          </View>
        )}
        ListHeaderComponentStyle={l.listHeader}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: item.value === selected }} onPress={() => pick(item.value)}>
            {({ pressed }) => (
              <View style={[l.row, pressed && l.rowPressed]}>
                <Text style={[l.rowTitle, l.rowText]}>{item.label}</Text>
                {item.value === selected ? <Icon name="check" color={colors.accent} /> : null}
              </View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={<Text style={[t.muted, t.center]}>Nothing matches.</Text>}
      />
    </>
  );
}
