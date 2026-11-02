/**
 * Signal strength as four rising bars (SVG), for Bluetooth RSSI and Wi-Fi signal alike.
 * Pass `bars` 0..4 (see `rssiBars` / `percentBars` in lib/format/numbers).
 */
import Svg, { Rect } from "react-native-svg";
import { useTheme } from "@/theme";

export function SignalBars({ bars, fontSize, label }: { bars: number; fontSize?: number; label?: string }) {
  const theme = useTheme();
  const size = Math.round((fontSize ?? theme.fontSize.body) * 1.2);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible accessibilityLabel={label ?? `Signal ${bars} of 4`}>
      {[0, 1, 2, 3].map((i) => {
        const height = 6 + i * 5;
        return (
          <Rect
            key={i}
            x={1 + i * 6}
            y={22 - height}
            width={4}
            height={height}
            rx={1}
            fill={i < bars ? theme.colors.text : theme.colors.track}
          />
        );
      })}
    </Svg>
  );
}
