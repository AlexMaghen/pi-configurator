/**
 * Page wrapper: themed background, keyboard avoidance, a scrolling body and an optional
 * bottom action bar that stays above the keyboard and the home indicator.
 *
 * KeyboardAvoidingView compares its own (parent-relative) frame with the keyboard's screen
 * position, so it needs the page's distance from the top of the screen as its offset. That
 * isn't a constant: on iOS 26 the header is see-through and the page starts at the top of the
 * screen, while an opaque header pushes it down. The wrapper measures it instead.
 */
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, View, type RefreshControlProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayoutStyles } from "@/styles/layout";

export interface ScreenProps {
  children: ReactNode;
  /** Pinned to the bottom (e.g. Save / Discard). */
  actions?: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /** Render children without a ScrollView (for lists that scroll themselves). */
  scroll?: boolean;
}

export function Screen({ children, actions, refreshControl, scroll = true }: ScreenProps) {
  const s = useLayoutStyles();
  const insets = useSafeAreaInsets();
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [top, setTop] = useState(0);
  // The action bar keeps clear of the home indicator, except when the keyboard covers it.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const shown = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardUp(true));
    const hidden = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return (
    <View
      ref={frame}
      style={s.screen}
      onLayout={() => frame.current?.measureInWindow((_x, y) => setTop(Math.max(0, y)))}
    >
      <KeyboardAvoidingView
        style={s.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={top}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={s.page}
            keyboardShouldPersistTaps="handled"
            // Number pads have no return key: scrolling the page puts the keyboard away.
            keyboardDismissMode="interactive"
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={refreshControl}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={s.screen}>{children}</View>
        )}
        {actions ? (
          <View style={[s.actionBar, { paddingBottom: keyboardUp ? 12 : Math.max(insets.bottom, 12) }]}>
            <View style={s.actionBarRow}>{actions}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}
