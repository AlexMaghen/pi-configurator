/** Button styles: primary (filled), secondary (muted), danger, and plain text buttons. */
import { createStyles } from "@/theme";

export const useButtonStyles = createStyles((t) => ({
  base: {
    minHeight: t.touchTarget + 4,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.space.sm,
  },
  grow: { flex: 1 },
  primary: { backgroundColor: t.colors.accent },
  secondary: { backgroundColor: t.colors.surfaceMuted },
  danger: { backgroundColor: t.colors.danger },
  plain: { backgroundColor: "transparent", paddingHorizontal: t.space.sm },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  label: { fontSize: t.fontSize.body, fontWeight: t.fontWeight.semibold },
  labelPrimary: { color: t.colors.onAccent },
  labelSecondary: { color: t.colors.text },
  labelDanger: { color: "#FFFFFF" },
  labelPlain: { color: t.colors.accent },
  /** Small icon-only button in a navigation header. */
  headerIcon: { minWidth: t.touchTarget, minHeight: t.touchTarget, alignItems: "center", justifyContent: "center" },
}));
