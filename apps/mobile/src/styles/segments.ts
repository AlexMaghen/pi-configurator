/** Segmented control styles: a muted track with the selected segment raised on a surface pill. */
import { createStyles } from "@/theme";

export const useSegmentStyles = createStyles((t) => ({
  track: {
    flexDirection: "row",
    padding: t.space.xxs,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  segment: {
    flex: 1,
    minHeight: t.touchTarget - 8,
    borderRadius: t.radius.md - t.space.xxs,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.space.sm,
  },
  segmentSelected: {
    backgroundColor: t.colors.surface,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  pressed: { opacity: 0.7 },
  label: { fontSize: t.fontSize.small, fontWeight: t.fontWeight.medium, color: t.colors.textMuted },
  labelSelected: { fontSize: t.fontSize.small, fontWeight: t.fontWeight.semibold, color: t.colors.text },
}));
