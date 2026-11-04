/**
 * Layout styles shared by every screen: the scrolling page, grouped sections (iOS-style inset
 * cards), rows inside them, and footers. Screens compose these instead of defining their own.
 */
import { createStyles } from "@/theme";

/** Widest a page's content gets; on iPad it stays this wide, centred, so rows stay readable. */
export const READABLE_WIDTH = 720;

export const useLayoutStyles = createStyles((t) => ({
  /** Full-screen background. */
  screen: { flex: 1, backgroundColor: t.colors.background },
  /** Padding for a scrolling page's content. */
  page: {
    padding: t.space.lg,
    paddingBottom: t.space.xxl,
    gap: t.space.xl,
    width: "100%",
    maxWidth: READABLE_WIDTH,
    alignSelf: "center",
  },
  /** The same width limit for lists that scroll themselves (FlatList contentContainerStyle). */
  readableList: { width: "100%", maxWidth: READABLE_WIDTH, alignSelf: "center" },
  /** A titled block of rows. */
  section: { gap: t.space.sm },
  sectionTitle: {
    fontSize: t.fontSize.small,
    fontWeight: t.fontWeight.semibold,
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginLeft: t.space.lg,
  },
  /** The muted note under a section's card, and under its title (Section `description`). */
  sectionFooter: { fontSize: t.fontSize.small, color: t.colors.textMuted, marginHorizontal: t.space.lg },
  /** The rounded card that holds rows. */
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    overflow: "hidden",
  },
  /** Padded content inside a card that isn't a row list. */
  cardBody: { padding: t.space.lg, gap: t.space.sm },
  /** A tappable or static row in a card. */
  row: {
    minHeight: t.touchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
    gap: t.space.md,
    backgroundColor: t.colors.surface,
  },
  rowPressed: { backgroundColor: t.colors.surfaceMuted },
  rowText: { flex: 1, gap: t.space.xxs },
  /** Title block of a row that also shows a value: never shrinks, so the title never wraps. */
  rowTextBeside: { flexShrink: 0, maxWidth: "50%", gap: t.space.xxs },
  rowTitle: { fontSize: t.fontSize.body, color: t.colors.text },
  rowTitleDanger: { fontSize: t.fontSize.body, color: t.colors.danger },
  rowSubtitle: { fontSize: t.fontSize.small, color: t.colors.textMuted },
  rowValue: { fontSize: t.fontSize.body, color: t.colors.textMuted, flex: 1, textAlign: "right" },
  /** Header above a full-width list (search field and notes). */
  listHeader: { marginBottom: t.space.md },
  listHeaderBody: { padding: t.space.lg, paddingBottom: 0, gap: t.space.sm },
  /** The device report's lines (Device Data): "Label: value", one per line, selectable. */
  detailText: { fontSize: t.fontSize.label, lineHeight: t.fontSize.label * 1.5, color: t.colors.text },
  detailLabel: { color: t.colors.textMuted },
  /** Hairline between rows, inset to line up with row text. */
  divider: { height: 1, backgroundColor: t.colors.border, marginLeft: t.space.lg, opacity: 0.6 },
  /** Holds a divider in a full-width list so the inset gap shows the row color, not the page. */
  dividerTrack: { backgroundColor: t.colors.surface },
  /** Minimum height for an empty-state block inside a scrolling page. */
  emptyBlock: { minHeight: 320 },
  /** Bottom bar with the main action (e.g. Save). */
  actionBar: {
    paddingHorizontal: t.space.lg,
    paddingTop: t.space.md,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
    backgroundColor: t.colors.surface,
  },
  /** The buttons inside the action bar, kept to the page's width. */
  actionBarRow: {
    flexDirection: "row",
    gap: t.space.md,
    width: "100%",
    maxWidth: READABLE_WIDTH - 2 * t.space.lg,
    alignSelf: "center",
  },
  /** Centered block for empty and loading states. */
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: t.space.xl, gap: t.space.md },
  inline: { flexDirection: "row", alignItems: "center", gap: t.space.sm },
  spread: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: t.space.sm },
}));
