import { SceneAppPage } from '@grafana/scenes';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { getResourceSimulatorScene } from './resourceSimulatorScene';

const RESOURCE_SIMULATOR_URL = `${PLUGIN_BASE_URL}/${ROUTES.ResourceSimulator}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

export function getResourceSimulatorPage() {
  return new SceneAppPage({
    title: 'Resource Simulator',
    subTitle: 'Namespace quota and capacity what-if modeling',
    titleImg: KUBERNETES_ICON,
    url: RESOURCE_SIMULATOR_URL,
    routePath: `/${ROUTES.ResourceSimulator}/*`,
    getScene: getResourceSimulatorScene,
  });
}
