import React from 'react';
import { AppRootProps } from '@grafana/data';
import { useSceneApp } from '@grafana/scenes';
import { getClustersSceneApp } from '../../scenes/clustersApp';
import { setAppJsonData, type AppJsonData } from '../../utils/appJsonData';

function App(props: AppRootProps<AppJsonData>) {
  setAppJsonData(props.meta.jsonData);
  const scene = useSceneApp(getClustersSceneApp);

  return <scene.Component model={scene} />;
}

export default App;
