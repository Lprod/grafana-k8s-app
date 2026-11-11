import { sceneGraph, VizPanel } from '@grafana/scenes';

// A friendly sentence for a table with *no rows* - and only then.
//
// The obvious way to get one, `PanelBuilders.table().setNoValue('...')`, is a
// trap on the Table panel: `fieldConfig.defaults.noValue` is what Grafana
// shows instead of "No data" for an empty result, but it is *also* what the
// table prints into every empty cell of a populated row. So a "Pending pods"
// row whose pod has no workload attribution read, in its own WORKLOAD and
// TYPE cells, "No pods are stuck in Pending." - the table contradicting the
// very row it was drawn in. (An earlier pass hit this on 31 tables and backed
// the sentences out again; the two home page tables kept theirs.)
//
// This behavior keeps the sentence and removes the side effect: it watches
// the panel's own data and sets `noValue` only while the result has zero
// rows, clearing it again the moment a row shows up.
//
// `message` may be a function for a table whose query is swapped at runtime
// (the home page's shared issue table) - it is read when data arrives.
//
// Usage: `.setBehaviors([emptyTableMessage('No ... found.')])`.
export function emptyTableMessage(message: string | (() => string)) {
  return (panel: VizPanel) => {
    const dataProvider = sceneGraph.getData(panel);

    const apply = () => {
      const data = dataProvider.state.data;
      if (!data) {
        return;
      }
      const rows = data.series.reduce((count, frame) => count + frame.length, 0);
      const noValue = rows === 0 ? (typeof message === 'function' ? message() : message) : undefined;
      const { fieldConfig } = panel.state;
      if (fieldConfig.defaults.noValue !== noValue) {
        panel.setState({ fieldConfig: { ...fieldConfig, defaults: { ...fieldConfig.defaults, noValue } } });
        // VizPanel caches the frames it last applied field config to, keyed on
        // the raw data - a config-only change has to drop that cache itself.
        panel.clearFieldConfigCache();
      }
    };

    apply();
    const subscription = dataProvider.subscribeToState(apply);
    return () => subscription.unsubscribe();
  };
}
