/** A small pill label ("Saved", "Set", "Demo"). */
import { Text, View } from "react-native";
import { useFormStyles } from "@/styles/form";

export function Badge({ label, color, background }: { label: string; color?: string; background?: string }) {
  const s = useFormStyles();
  return (
    <View style={[s.badge, background ? { backgroundColor: background } : null]}>
      <Text style={[s.badgeText, color ? { color } : null]}>{label}</Text>
    </View>
  );
}
