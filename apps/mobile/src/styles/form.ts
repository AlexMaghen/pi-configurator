/** Form styles: labels, inputs, help and error lines, badges. Used by every field control. */
import { createStyles } from "@/theme";

export const useFormStyles = createStyles((t) => ({
  /** One field: label, control, help, error. */
  field: { paddingHorizontal: t.space.lg, paddingVertical: t.space.md, gap: t.space.xs },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: t.space.sm },
  label: { fontSize: t.fontSize.label, fontWeight: t.fontWeight.medium, color: t.colors.text, flexShrink: 1 },
  input: {
    minHeight: t.touchTarget,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.md,
    fontSize: t.fontSize.body,
    color: t.colors.text,
    backgroundColor: t.colors.surface,
  },
  /** An input that shares its row (with a unit or a reveal button). */
  inputFlex: { flex: 1 },
  inputMultiline: { minHeight: 96, paddingTop: t.space.sm, textAlignVertical: "top" },
  inputDisabled: { backgroundColor: t.colors.surfaceMuted, color: t.colors.textMuted },
  inputError: { borderColor: t.colors.danger },
  inputChanged: { borderColor: t.colors.accent },
  /** Input with a unit after it ("ms"). */
  inputWithUnit: { flexDirection: "row", alignItems: "center", gap: t.space.sm },
  unit: { fontSize: t.fontSize.body, color: t.colors.textMuted },
  help: { fontSize: t.fontSize.small, color: t.colors.textMuted },
  /** The device name in the device screen's header, 25% above iOS's usual title. */
  deviceTitle: { fontSize: t.fontSize.deviceTitle, fontWeight: t.fontWeight.semibold, color: t.colors.text },
  /** The device's description at the top of the device screen: help text, full width. */
  deviceDescription: { fontSize: t.fontSize.small, color: t.colors.textMuted, textAlign: "left", alignSelf: "stretch" },
  error: { fontSize: t.fontSize.small, color: t.colors.danger },
  /** Small links under a field ("Reset to default"). */
  fieldActions: { flexDirection: "row", gap: t.space.lg, marginTop: t.space.xxs },
  fieldAction: { fontSize: t.fontSize.small, color: t.colors.accent, paddingVertical: t.space.xs },
  /** Pill-shaped label ("Saved", "Set", "Demo"). */
  badge: {
    paddingHorizontal: t.space.sm,
    paddingVertical: t.space.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceMuted,
  },
  badgeText: { fontSize: t.fontSize.caption, fontWeight: t.fontWeight.medium, color: t.colors.textMuted },
  /** Tappable "picker" control that opens a stand-alone choice screen. */
  picker: {
    minHeight: t.touchTarget,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: t.space.sm,
  },
  pickerText: { flex: 1, fontSize: t.fontSize.body, color: t.colors.text },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: t.space.md },
}));
