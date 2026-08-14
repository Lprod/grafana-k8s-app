import React from 'react';
import { SceneComponentProps, SceneTimeRangeCompare } from '@grafana/scenes';
import { Badge, Dropdown, Menu } from '@grafana/ui';

// Fixed set instead of the base class's range-adaptive Day/Week/Month-before
// options (which also drop "Day before" once the panel's time range exceeds
// 24h) - this app always wants Hour/Day/Week-before as choices. "None" has
// to be a real entry in this list (not just the base class's default
// behavior) because the compact renderer below has no separate checkbox to
// turn a panel's comparison back off - clearing it has to be a selectable
// option. Its value has to be the exact string SceneTimeRangeCompare's
// onCompareWithChanged() checks internally to call onClearCompare() - that
// sentinel isn't exported from @grafana/scenes, so it's inlined here
// (verified against the installed package's compiled source; a future
// @grafana/scenes upgrade could change it).
const NONE_VALUE = '__noPeriod';
const PANEL_COMPARE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'None', value: NONE_VALUE },
  { label: 'Hour before', value: '1h' },
  { label: 'Day before', value: '24h' },
  { label: 'Week before', value: '1w' },
];

// A per-panel comparison control, passed to VizPanelBuilder.setHeaderActions()
// instead of living once in a page's top-level `controls` (see Grafana Play's
// "Predict CPU Usage" panel for the same per-panel-control pattern). Scenes'
// SceneQueryRunner discovers the closest ExtraQueryProvider by walking up the
// scene graph from its parent (see getClosestExtraQueryProviders in
// @grafana/scenes), and setHeaderActions registers its argument as a real
// child of the VizPanel - so an instance placed there scopes the compare
// toggle, and the shifted comparison query it adds, to that single panel.
//
// Renders as its own small pill + dropdown menu (below) rather than the base
// class's built-in ButtonGroup+ButtonSelect, which reads as a full toolbar
// control and is too heavy for a panel header slot - styled to match this
// app's own Resource Simulator quota cards (the "Unlimited" pill next to
// e.g. "CPU requests quota", see StatusBadge in ResourceSimulatorObject.tsx),
// which are themselves just @grafana/ui's Badge.
export class PanelTimeRangeCompare extends SceneTimeRangeCompare {
  static Component = PanelTimeRangeCompareRenderer;

  constructor() {
    super({ compareOptions: PANEL_COMPARE_OPTIONS, hideCheckbox: true });
    this.getCompareOptions = () => PANEL_COMPARE_OPTIONS;
  }
}

function PanelTimeRangeCompareRenderer({ model }: SceneComponentProps<PanelTimeRangeCompare>) {
  const { compareWith, compareOptions } = model.useState();
  const activeOption = compareOptions.find((option) => option.value === compareWith);

  const menu = (
    <Menu>
      {compareOptions.map((option) => (
        <Menu.Item
          key={option.value}
          label={option.label}
          active={option.value === (compareWith ?? NONE_VALUE)}
          onClick={() => model.onCompareWithChanged(option.value)}
        />
      ))}
    </Menu>
  );

  return (
    <Dropdown overlay={menu} placement="bottom-end">
      {/* Badge itself isn't clickable (no ref forwarding, no onClick in its
          props) - Dropdown clones its trigger element to inject the click/ref
          handlers that open the menu, so a real <button> carries those and
          Badge just renders its normal, non-interactive visual inside it. */}
      <button
        type="button"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}
      >
        <Badge
          color={activeOption ? 'purple' : 'blue'}
          text={activeOption ? activeOption.label : 'Compare'}
          tooltip={activeOption ? `Comparing to ${activeOption.label.toLowerCase()}` : 'Compare with a previous period'}
        />
      </button>
    </Dropdown>
  );
}
