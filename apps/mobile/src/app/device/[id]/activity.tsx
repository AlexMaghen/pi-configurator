/** Activity: every status event the Pi sent in this app session, newest first. */
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { EmptyState } from "@/components/EmptyState";
import { Screen } from "@/components/Screen";
import { Section } from "@/components/Section";
import { StatusFeed } from "@/components/StatusFeed";
import { useSession } from "@/lib/session/AppProvider";
import { useLayoutStyles } from "@/styles/layout";

export default function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession(id);
  const l = useLayoutStyles();
  if (session.activity.length === 0) {
    return (
      <View style={l.screen}>
        <EmptyState icon="activity" title="Nothing yet" body="When you save settings, the device reports each step here." />
      </View>
    );
  }
  return (
    <Screen>
      <Section title="From the device" footer="Kept until the app closes.">
        <View style={l.cardBody}>
          <StatusFeed entries={session.activity} newestFirst live={!!session.busy} />
        </View>
      </Section>
    </Screen>
  );
}
