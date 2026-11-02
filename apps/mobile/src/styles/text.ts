/** Text styles by role. Use these rather than setting font sizes or colors in screens. */
import { createStyles } from "@/theme";

export const useTextStyles = createStyles((t) => ({
  hero: { fontSize: t.fontSize.hero, fontWeight: t.fontWeight.bold, color: t.colors.text },
  title: { fontSize: t.fontSize.title, fontWeight: t.fontWeight.semibold, color: t.colors.text },
  body: { fontSize: t.fontSize.body, color: t.colors.text, lineHeight: 22 },
  muted: { fontSize: t.fontSize.body, color: t.colors.textMuted, lineHeight: 22 },
  small: { fontSize: t.fontSize.small, color: t.colors.textMuted },
  caption: { fontSize: t.fontSize.caption, color: t.colors.textMuted },
  error: { fontSize: t.fontSize.small, color: t.colors.danger },
  success: { fontSize: t.fontSize.small, color: t.colors.success },
  link: { fontSize: t.fontSize.body, color: t.colors.accent },
  center: { textAlign: "center" },
  /** Monospace for ids and versions. */
  mono: { fontFamily: "Menlo", fontSize: t.fontSize.small, color: t.colors.textMuted },
}));
