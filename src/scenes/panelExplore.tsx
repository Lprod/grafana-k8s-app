import { SceneObject, VizPanel, VizPanelMenu, getExploreURL, sceneGraph } from '@grafana/scenes';
import { locationService } from '@grafana/runtime';

function isVizPanel(obj: SceneObject): obj is VizPanel {
  return obj instanceof VizPanel;
}

// `getExploreURL` (the same helper @grafana/scenes' own built-in
// VizPanelExploreButton header-button uses) needs the panel's already-run
// $data and live time range, both only available once the panel has
// actually queried - not knowable synchronously at menu-construction time,
// so the URL is computed inside the click handler instead of up front.
function addExploreMenuItem(panel: VizPanel) {
  if (panel.state.menu) {
    return;
  }
  panel.setState({
    menu: new VizPanelMenu({
      items: [
        {
          text: 'Explore',
          iconClassName: 'compass',
          onClick: async () => {
            const data = sceneGraph.getData(panel).state.data;
            const timeRange = sceneGraph.getTimeRange(panel).state.value;
            if (!data) {
              return;
            }
            const url = await getExploreURL(data, panel, timeRange);
            if (url) {
              locationService.push(url);
            }
          },
        },
      ],
    }),
  });
}

// `$behaviors` entry - attach to every EmbeddedScene's own `body` so its
// panels get a "..." menu (previously absent entirely - none of this app's
// panels had one) with a single "Explore" item, mirroring Grafana's own
// compass icon, that opens Explore prefilled with that exact panel's
// queries. `sceneGraph.findAllObjects` walks the *static* scene tree set at
// construction time (SceneFlexLayout/SceneFlexItem/VizPanel are all plain
// state, not lazily created), so running this once on the EmbeddedScene's
// own activation reliably finds every VizPanel already declared in its
// `body` - no per-panel wiring needed at each individual `.build()` call
// site.
export function attachExploreMenus(scene: SceneObject) {
  sceneGraph
    .findAllObjects(scene, isVizPanel)
    .filter(isVizPanel)
    .forEach(addExploreMenuItem);
}
