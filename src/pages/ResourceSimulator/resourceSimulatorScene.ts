import {
  EmbeddedScene,
  SceneControlsSpacer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneRefreshPicker,
  SceneTimeRange,
  SceneVariableSet,
  VariableValueSelectors,
} from '@grafana/scenes';
import {
  createClusterFilterVariable,
  createNamespaceFilterVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';
import { ResourceSimulatorObject } from './ResourceSimulatorObject';

export function getResourceSimulatorScene() {
  return new EmbeddedScene({
    $timeRange: new SceneTimeRange({ from: 'now-15m', to: 'now' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable({ isMulti: false }),
        createNamespaceFilterVariable({ isMulti: false }),
      ],
    }),
    controls: [new VariableValueSelectors({}), new SceneControlsSpacer(), new SceneRefreshPicker({})],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [new SceneFlexItem({ minHeight: 760, body: new ResourceSimulatorObject() })],
    }),
  });
}
