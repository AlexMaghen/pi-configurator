/**
 * Page wrapper: themed background, keyboard avoidance, a scrolling body and an optional
 * bottom action bar that stays above the keyboard and the home indicator.
 */
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View, type RefreshControlProps } from "react-native";
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
  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={s.page}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={s.screen}>{children}</View>
      )}
      {actions ? <View style={[s.actionBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>{actions}</View> : null}
    </KeyboardAvoidingView>
  );
}
