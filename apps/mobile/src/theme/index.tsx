/**
 * The theme: palette for the current color scheme plus the shared tokens.
 *
 *   const theme = useTheme();                     // inside components
 *   const useStyles = createStyles((t) => ({...})); // in style modules (see src/styles)
 *
 * Follows the phone's light/dark setting (app.config: userInterfaceStyle "automatic").
 */
import { useMemo } from "react";
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { darkPalette, lightPalette, type Palette } from "./colors";
import { fontSize, fontWeight, radius, space, touchTarget } from "./tokens";

export interface Theme {
  scheme: "light" | "dark";
  colors: Palette;
  space: typeof space;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
  touchTarget: number;
}

const themes: Record<Theme["scheme"], Theme> = {
  light: { scheme: "light", colors: lightPalette, space, radius, fontSize, fontWeight, touchTarget },
  dark: { scheme: "dark", colors: darkPalette, space, radius, fontSize, fontWeight, touchTarget },
};

export function useTheme(): Theme {
  return themes[useColorScheme() === "dark" ? "dark" : "light"];
}

/** A named set of styles, as StyleSheet.create takes it. */
type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Builds a style hook from a factory. Styles are created once per color scheme and cached, so
 * components get the same objects on every render.
 */
export function createStyles<S extends NamedStyles>(factory: (theme: Theme) => S & NamedStyles): () => Readonly<S> {
  const cache = new Map<Theme["scheme"], Readonly<S>>();
  return function useStyles() {
    const theme = useTheme();
    return useMemo(() => {
      const cached = cache.get(theme.scheme);
      if (cached) return cached;
      const styles = StyleSheet.create(factory(theme));
      cache.set(theme.scheme, styles);
      return styles;
    }, [theme]);
  };
}

export type { Palette };
