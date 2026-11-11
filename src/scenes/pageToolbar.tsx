import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneControlsSpacer, SceneObject, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { useStyles2 } from '@grafana/ui';

// A page's whole toolbar as ONE wrapping flex row.
//
// SceneAppPage hands its `controls` to Grafana's PluginPage as `actions`, and
// Grafana lays those out in a single `flex-wrap: nowrap` row with default
// (stretch) cross-axis alignment. Passing every control as its own child of
// that row had three visible consequences once a page carried more than a
// couple of pickers, or simply had less width than a maximised 1920px window
// (docked navigation, an open Assistant sidebar, a laptop):
//   - the row could only *shrink* its children, so multi-value pickers were
//     squeezed until their "All" chip rendered as "A" and then as nothing,
//     and a long data source name broke onto a second line inside its box;
//   - once nothing could shrink any further the row overflowed the page -
//     on the Alerts page and the Workload/Pod/Node Drilldowns the time
//     picker, refresh, copy-link and jump buttons ended up off-screen behind
//     a horizontal scrollbar;
//   - on a page with a subtitle (Search) the row is as tall as title plus
//     subtitle, and the stretch alignment made the data source picker that
//     tall too.
// Wrapping the controls in a single child that is itself a *wrapping* flex
// container fixes all three: pickers keep their natural size and move onto a
// second line instead, and are centred rather than stretched. `min-width: 0`
// is what lets Grafana's row shrink this one child to the available width in
// the first place (a flex item's automatic minimum is its content width).
//
// The child controls stay ordinary scene objects below this one, so their
// own lookups (variables, time range, data layers) still walk up to the page.
interface PageToolbarState extends SceneObjectState {
  controls: SceneObject[];
}

class PageToolbar extends SceneObjectBase<PageToolbarState> {
  static Component = PageToolbarRenderer;
}

function PageToolbarRenderer({ model }: SceneComponentProps<PageToolbar>) {
  const { controls } = model.useState();
  const styles = useStyles2(getStyles);
  // Everything before the page's SceneControlsSpacer is a filter/picker,
  // everything after it the time range, refresh and link buttons. The pickers
  // flow and wrap one by one; the second group is kept together as a single
  // item pushed to the right edge (auto margin), so it shares the last line
  // of pickers when there is room and takes a line of its own when there is
  // not - right-aligned either way. (The bare spacer can't do that inside a
  // wrapping row: it has no width, so it stays at the end of the first line
  // and the time picker lands left-aligned on the second.)
  const spacerIndex = controls.findIndex((control) => control instanceof SceneControlsSpacer);
  const filters = spacerIndex === -1 ? controls : controls.slice(0, spacerIndex);
  const actions = spacerIndex === -1 ? [] : controls.slice(spacerIndex + 1);
  const render = (control: SceneObject) => <control.Component model={control} key={control.state.key} />;
  return (
    <div className={styles.toolbar}>
      {filters.map(render)}
      {actions.length > 0 && <div className={styles.actions}>{actions.map(render)}</div>}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    toolbar: css({
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      alignSelf: 'center',
      gap: theme.spacing(1),
      flex: '1 1 auto',
      minWidth: 0,
    }),
    actions: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      flex: 'none',
      marginLeft: 'auto',
    }),
  };
}

// Drop-in for a SceneAppPage's `controls: [...]`.
export function pageToolbar(controls: SceneObject[]): SceneObject[] {
  return [new PageToolbar({ controls })];
}
