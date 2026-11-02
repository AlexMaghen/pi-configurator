/** A titled group of rows in an inset card, with an optional footer note. */
import { Children, Fragment, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useLayoutStyles } from "@/styles/layout";

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const s = useLayoutStyles();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={s.section}>
      {title ? <Text style={s.sectionTitle} accessibilityRole="header">{title}</Text> : null}
      <View style={s.card}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={s.divider} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={s.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}
