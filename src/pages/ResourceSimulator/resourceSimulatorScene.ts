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
  createSimulatorNamespaceVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';
import { ResourceSimulatorObject } from './ResourceSimulatorObject';
import { attachExploreMenus } from '../../scenes/panelExplore';
import { copyLinkControl } from '../../scenes/copyLink';

export function getResourceSimulatorScene() {
  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    $timeRange: new SceneTimeRange({ from: 'now-15m', to: 'now' }),
    $variables: new SceneVariableSet({
      variables: [
        createThanosDatasourceVariable(),
        createClusterFilterVariable({ isMulti: false }),
        // Busiest namespace first, so the page opens on one it can model.
        createSimulatorNamespaceVariable(),
      ],
    }),
    controls: [
      new VariableValueSelectors({}),
      new SceneControlsSpacer(),
      new SceneRefreshPicker({}),
      copyLinkControl(),
    ],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [new SceneFlexItem({ minHeight: 760, body: new ResourceSimulatorObject() })],
    }),
  });
}
