import {
  SceneAppPage,
  SceneControlsSpacer,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { PLUGIN_BASE_URL } from '../../constants';
import { getKubernetesAlertsScene } from './kubernetesAlertsScene';
import { getKubernetesEfficiencyScene } from './kubernetesEfficiencyScene';
import { getKubernetesOverviewScene } from './kubernetesOverviewScene';
import {
  CLUSTER_VARIABLE_NAME,
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';

const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

// This is the plugin's own root URL - `src/plugin.json`'s app name
// ("Kubernetes") is what Grafana shows as the parent nav entry one level
// above Clusters/Nodes/Namespaces/Workloads/Alerts, and clicking it lands
// here. Without a page matching the bare root, Scenes falls back to its
// built-in "Not found" page - this is that landing page.
export function getKubernetesHomePage() {
  return new SceneAppPage({
    title: 'Kubernetes',
    titleImg: KUBERNETES_ICON,
    url: PLUGIN_BASE_URL,
    // Needs to end in `/*`, not just `/`, so react-router still descends
    // into this page's own tab routing for `/overview`, `/efficiency`, etc.
    // - a bare `/` would only ever match the empty root path itself.
    routePath: '/*',
    tabs: [
      new SceneAppPage({
        title: 'Overview',
        url: `${PLUGIN_BASE_URL}/overview`,
        routePath: 'overview',
        getScene: getKubernetesOverviewScene,
      }),
      new SceneAppPage({
        title: 'Efficiency',
        url: `${PLUGIN_BASE_URL}/efficiency`,
        routePath: 'efficiency',
        getScene: getKubernetesEfficiencyScene,
      }),
      new SceneAppPage({
        title: 'Alerts',
        url: `${PLUGIN_BASE_URL}/alerts-tab`,
        // Deliberately not the "alerts" slug - the standalone Alerts page
        // already owns `/alerts/*` as a sibling top-level route, and a more
        // specific static sibling always wins over this page's `/*` match,
        // so a tab literally named "alerts" here would be unreachable.
        routePath: 'alerts-tab',
        getScene: getKubernetesAlertsScene,
      }),
    ],
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({
      variables: [createThanosDatasourceVariable(), createClusterFilterVariable(), createNamespaceFilterVariable()],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
  });
}
