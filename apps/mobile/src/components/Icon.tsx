/**
 * The app's one icon set: inline SVG line icons on a 24x24 grid (react-native-svg).
 *
 * The owner's rule: never type symbol characters as icons (they turn into colored emoji on
 * phones). Every icon in the UI comes from here.
 *
 *   <Icon name="lock" />                      // 1.25 x the body text size
 *   <Icon name="chevronRight" em={1} fontSize={13} color={colors.textMuted} />
 *
 * Size is relative to the text the icon sits next to: `fontSize` (default: body size) times `em`.
 */
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";
import { useTheme } from "@/theme";

export type IconName =
  | "activity"
  | "alert"
  | "bluetooth"
  | "bluetoothOff"
  | "check"
  | "chevronDown"
  | "chevronRight"
  | "close"
  | "cpu"
  | "eye"
  | "eyeOff"
  | "info"
  | "key"
  | "lock"
  | "logout"
  | "more"
  | "pencil"
  | "plus"
  | "power"
  | "refresh"
  | "search"
  | "settings"
  | "trash"
  | "wifi";

/** Each icon's strokes, drawn on a 24x24 grid with round caps. */
const SHAPES: Record<IconName, React.ReactNode> = {
  activity: <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  alert: (
    <>
      <Path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <Line x1="12" y1="9" x2="12" y2="13" />
      <Line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  bluetooth: <Polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5" />,
  bluetoothOff: (
    <>
      <Polyline points="17.5 17.5 12 23 12 12" />
      <Line x1="2" y1="2" x2="22" y2="22" />
      <Polyline points="12 6 12 1 17.5 6.5 15 9" />
      <Line x1="6.5" y1="17.5" x2="10" y2="14" />
    </>
  ),
  check: <Polyline points="20 6 9 17 4 12" />,
  chevronDown: <Polyline points="6 9 12 15 18 9" />,
  chevronRight: <Polyline points="9 18 15 12 9 6" />,
  close: (
    <>
      <Line x1="18" y1="6" x2="6" y2="18" />
      <Line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  cpu: (
    <>
      <Rect x="4" y="4" width="16" height="16" rx="2" />
      <Rect x="9" y="9" width="6" height="6" />
      <Line x1="9" y1="1" x2="9" y2="4" />
      <Line x1="15" y1="1" x2="15" y2="4" />
      <Line x1="9" y1="20" x2="9" y2="23" />
      <Line x1="15" y1="20" x2="15" y2="23" />
      <Line x1="20" y1="9" x2="23" y2="9" />
      <Line x1="20" y1="14" x2="23" y2="14" />
      <Line x1="1" y1="9" x2="4" y2="9" />
      <Line x1="1" y1="14" x2="4" y2="14" />
    </>
  ),
  eye: (
    <>
      <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <Path d="M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9" />
      <Path d="M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2" />
      <Path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" />
      <Line x1="1" y1="1" x2="23" y2="23" />
    </>
  ),
  info: (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Line x1="12" y1="16" x2="12" y2="12" />
      <Line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  key: (
    <>
      <Circle cx="7.5" cy="15.5" r="4.5" />
      <Path d="M10.7 12.3 21 2" />
      <Path d="m16 7 3 3" />
      <Path d="m18.5 4.5 2.5 2.5" />
    </>
  ),
  lock: (
    <>
      <Rect x="3" y="11" width="18" height="11" rx="2" />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  logout: (
    <>
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <Polyline points="16 17 21 12 16 7" />
      <Line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  more: (
    <>
      <Circle cx="5" cy="12" r="1.2" />
      <Circle cx="12" cy="12" r="1.2" />
      <Circle cx="19" cy="12" r="1.2" />
    </>
  ),
  pencil: <Path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  plus: (
    <>
      <Line x1="12" y1="5" x2="12" y2="19" />
      <Line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  power: (
    <>
      <Path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
      <Line x1="12" y1="2" x2="12" y2="12" />
    </>
  ),
  refresh: (
    <>
      <Polyline points="23 4 23 10 17 10" />
      <Polyline points="1 20 1 14 7 14" />
      <Path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
    </>
  ),
  search: (
    <>
      <Circle cx="11" cy="11" r="8" />
      <Line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  settings: (
    <>
      <Line x1="4" y1="21" x2="4" y2="14" />
      <Line x1="4" y1="10" x2="4" y2="3" />
      <Line x1="12" y1="21" x2="12" y2="12" />
      <Line x1="12" y1="8" x2="12" y2="3" />
      <Line x1="20" y1="21" x2="20" y2="16" />
      <Line x1="20" y1="12" x2="20" y2="3" />
      <Line x1="1" y1="14" x2="7" y2="14" />
      <Line x1="9" y1="8" x2="15" y2="8" />
      <Line x1="17" y1="16" x2="23" y2="16" />
    </>
  ),
  trash: (
    <>
      <Polyline points="3 6 5 6 21 6" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <Path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ),
  wifi: (
    <>
      <Path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <Path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <Path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <Line x1="12" y1="20" x2="12.01" y2="20" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Defaults to the theme's text color. */
  color?: string;
  /** Size of the text the icon sits next to. Defaults to the body size. */
  fontSize?: number;
  /** Icon size as a multiple of `fontSize`. */
  em?: number;
  strokeWidth?: number;
  /** Read by screen readers; leave out for decorative icons. */
  accessibilityLabel?: string;
}

export function Icon({ name, color, fontSize, em = 1.25, strokeWidth = 2, accessibilityLabel }: IconProps) {
  const theme = useTheme();
  const size = Math.round((fontSize ?? theme.fontSize.body) * em);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme.colors.text}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {SHAPES[name]}
    </Svg>
  );
}
