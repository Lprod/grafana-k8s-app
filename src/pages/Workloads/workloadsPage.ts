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
  NAMESPACE_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  WORKLOAD_VARIABLE_NAME,
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
  createWorkloadFilterVariable,
} from '../../variables/datasourceVariables';

const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

export function getWorkloadsPage() {
  return new SceneAppPage({
    title: 'Workloads',
    titleImg: KUBERNETES_ICON,
    url: WORKLOADS_URL,
    routePath: `/${ROUTES.Workloads}/*`,
    getScene: () => getComingSoonScene('The workloads view has not been built yet.'),
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'utc' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable(),
        createNamespaceFilterVariable(),
        createWorkloadFilterVariable(),
      ],
    }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new VariableValueControl({ variableName: CLUSTER_VARIABLE_NAME }),
      new VariableValueControl({ variableName: NAMESPACE_VARIABLE_NAME }),
      new VariableValueControl({ variableName: WORKLOAD_VARIABLE_NAME }),
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
      `var-${NAMESPACE_VARIABLE_NAME}`,
      `var-${WORKLOAD_VARIABLE_NAME}`,
    ],
  });
}
