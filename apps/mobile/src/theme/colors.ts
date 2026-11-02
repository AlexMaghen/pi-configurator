/**
 * Color palettes for light and dark mode. Every color in the app comes from here by role, so a
 * global change is one edit. Names describe the role, not the hue.
 */
export interface Palette {
  /** Screen background behind grouped cards. */
  background: string;
  /** Cards, rows and inputs. */
  surface: string;
  /** Pressed rows, secondary buttons, disabled inputs. */
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  /** Buttons, links, selected items. */
  accent: string;
  /** Text and icons on top of `accent`. */
  onAccent: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  infoSoft: string;
  /** Unfilled signal bars. */
  track: string;
  /** The "Demo" label on the demo device. */
  demo: string;
  demoSoft: string;
}

export const lightPalette: Palette = {
  background: "#F2F2F7",
  surface: "#FFFFFF",
  surfaceMuted: "#E9E9EE",
  border: "#D6D6DC",
  text: "#111114",
  textMuted: "#6B6B73",
  accent: "#0A66D8",
  onAccent: "#FFFFFF",
  danger: "#C62828",
  dangerSoft: "#FDECEC",
  warning: "#9A5B00",
  warningSoft: "#FFF4E0",
  success: "#2E7D32",
  successSoft: "#E8F5E9",
  infoSoft: "#E8F0FC",
  track: "#C9C9D1",
  demo: "#7B3FC4",
  demoSoft: "#F1E8FC",
};

export const darkPalette: Palette = {
  background: "#000000",
  surface: "#1C1C1E",
  surfaceMuted: "#2C2C2E",
  border: "#3A3A3E",
  text: "#F5F5F7",
  textMuted: "#9A9AA2",
  accent: "#4C9BFF",
  onAccent: "#00152E",
  danger: "#FF6B6B",
  dangerSoft: "#3A1717",
  warning: "#FFB74D",
  warningSoft: "#3A2A10",
  success: "#66BB6A",
  successSoft: "#15301A",
  infoSoft: "#14243A",
  track: "#48484E",
  demo: "#C49BFF",
  demoSoft: "#2B1C40",
};
