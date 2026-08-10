import {
  SceneAppPage,
  SceneControlsSpacer,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueControl,
} from '@grafana/scenes';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { getComingSoonScene } from '../../scenes/comingSoon';
import {
  CLUSTER_VARIABLE_NAME,
  NODES_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createClusterFilterVariable,
  createNodesFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';

const NODES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Nodes}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

export function getNodesPage() {
  return new SceneAppPage({
    title: 'Nodes',
    titleImg: KUBERNETES_ICON,
    url: NODES_URL,
    routePath: `/${ROUTES.Nodes}/*`,
    getScene: () => getComingSoonScene('The nodes view has not been built yet.'),
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'utc' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable(),
        createNodesFilterVariable(`\${${CLUSTER_VARIABLE_NAME}:regex}`),
      ],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NODES_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: [
      'from',
      'to',
      'timezone',
      'refresh',
      `var-${THANOS_VARIABLE_NAME}`,
      `var-${CLUSTER_VARIABLE_NAME}`,
      `var-${NODES_VARIABLE_NAME}`,
    ],
  });
}
