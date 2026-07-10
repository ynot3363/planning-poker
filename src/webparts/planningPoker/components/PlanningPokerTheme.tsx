import * as React from 'react';
import { createTheme, ThemeProvider } from '@fluentui/react/lib/Theme';
import type { ITheme } from '@fluentui/react/lib/Theme';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';

/** Defines the props for the SharePoint-to-Fluent theme bridge. */
interface IPlanningPokerThemeProviderProps {
  /** The current SharePoint theme, when available. */
  readonly theme?: IReadonlyTheme;
  /** The React subtree that consumes Fluent UI theme values. */
  readonly children: React.ReactNode;
}

/**
 * Bridges the SPFx theme into Fluent UI.
 *
 * @param props - The current theme and child tree.
 * @returns The themed provider tree.
 */
export function PlanningPokerThemeProvider(
  props: IPlanningPokerThemeProviderProps
): React.ReactElement {
  const fluentTheme = React.useMemo<ITheme | undefined>(
    () =>
      props.theme === undefined
        ? undefined
        : createTheme({
            palette: props.theme.palette,
            semanticColors: props.theme.semanticColors,
            fonts: props.theme.fonts,
            effects: props.theme.effects,
            spacing: props.theme.spacing,
            isInverted: props.theme.isInverted
          }),
    [props.theme]
  );
  return <ThemeProvider theme={fluentTheme}>{props.children}</ThemeProvider>;
}
