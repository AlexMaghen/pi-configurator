/** Spacing, corner radii and type sizes shared by every style module. */

/** Spacing scale in points. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** Type scale. `body` is the base size; icons that sit next to text are sized from these. */
export const fontSize = { caption: 12, small: 13, body: 16, label: 15, title: 20, hero: 28 } as const;

export const fontWeight = { regular: "400", medium: "500", semibold: "600", bold: "700" } as const;

/** Minimum height of anything tappable (Apple HIG: 44 pt). */
export const touchTarget = 44;
