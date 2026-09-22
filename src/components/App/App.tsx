import React from 'react';
import { AppRootProps } from '@grafana/data';
import { useSceneApp } from '@grafana/scenes';
import { getClustersSceneApp } from '../../scenes/clustersApp';
import { setAppJsonData, type AppJsonData } from '../../utils/appJsonData';
import { useRecentObjectTracking } from '../../scenes/recentObjects';

function App(props: AppRootProps<AppJsonData>) {
  setAppJsonData(props.meta.jsonData);
  const scene = useSceneApp(getClustersSceneApp);
  // Feeds the Search page's "Recently viewed" list - see recentObjects.ts.
  useRecentObjectTracking();

  return <scene.Component model={scene} />;
}

export default App;
