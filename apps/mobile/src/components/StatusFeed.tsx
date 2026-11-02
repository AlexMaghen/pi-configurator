/**
 * Status events from the Pi ("Connecting to HomeNet", "Restarted studfs-robots.service") as a
 * list with an icon per outcome. Used inline while saving and on the Activity screen.
 */
import { ActivityIndicator, Text, View } from "react-native";
import type { StatusEvent } from "@pi-configurator/protocol";
import type { ActivityEntry } from "@/lib/session/AppStore";
import { clockTime } from "@/lib/format/numbers";
import { createStyles, useTheme } from "@/theme";
import { Icon, type IconName } from "./Icon";

const useStyles = createStyles((t) => ({
  list: { gap: t.space.sm },
  item: { flexDirection: "row", gap: t.space.md, alignItems: "flex-start" },
  marker: { width: 20, alignItems: "center", paddingTop: 1 },
  text: { flex: 1, gap: t.space.xxs },
  message: { fontSize: t.fontSize.label, color: t.colors.text },
  time: { fontSize: t.fontSize.caption, color: t.colors.textMuted },
}));

type Outcome = "progress" | "done" | "failed" | "info";

const OUTCOME: Record<StatusEvent["kind"], Outcome> = {
  "wifi.connecting": "progress",
  "wifi.connected": "done",
  "wifi.failed": "failed",
  "hostname.changed": "done",
  "timezone.changed": "done",
  "store.saved": "done",
  "service.restarting": "progress",
  "service.restarted": "done",
  "service.failed": "failed",
  "system.rebooting": "info",
  "session.ending": "info",
};

const ICON: Record<Exclude<Outcome, "progress">, IconName> = { done: "check", failed: "alert", info: "info" };

/**
 * `live`: the newest "in progress" entry shows a spinner (it hasn't finished yet).
 */
export function StatusFeed({ entries, live = false, newestFirst = false }: { entries: ActivityEntry[]; live?: boolean; newestFirst?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const ordered = newestFirst ? [...entries].reverse() : entries;
  const newest = entries[entries.length - 1];
  return (
    <View style={s.list} accessibilityLiveRegion="polite">
      {ordered.map((entry) => {
        const outcome = OUTCOME[entry.event.kind];
        const spinning = live && outcome === "progress" && entry === newest;
        const color = outcome === "failed" ? colors.danger : outcome === "done" ? colors.success : colors.textMuted;
        return (
          <View key={entry.id} style={s.item}>
            <View style={s.marker}>
              {spinning ? (
                <ActivityIndicator size="small" />
              ) : (
                <Icon name={outcome === "progress" ? "activity" : ICON[outcome]} color={color} fontSize={15} />
              )}
            </View>
            <View style={s.text}>
              <Text style={s.message}>{entry.event.message}</Text>
              <Text style={s.time}>{clockTime(entry.at)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
