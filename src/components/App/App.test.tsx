import { getClustersSceneApp } from '../../scenes/clustersApp';

// Fully mounting a Scenes app (VizPanel + panel plugin loading + datasource
// resolution) requires bootstrapping most of Grafana's runtime globals
// (config, plugin import utils, datasource service, location service...).
// That's better covered by running the plugin against a real Grafana
// instance, so here we only verify the scene object graph itself is wired up
// correctly: pages, routes and titles, without triggering activation/render.
describe('Components/App', () => {
  test('clusters scene app exposes the Clusters page with a cluster drilldown', () => {
    const sceneApp = getClustersSceneApp();
    const [clustersPage] = sceneApp.state.pages;

    expect(clustersPage.state.title).toBe('Clusters');
    expect(clustersPage.state.url).toBe('/a/debeka-k8s-app/clusters');
    expect(clustersPage.state.drilldowns).toHaveLength(1);
    expect(clustersPage.state.drilldowns?.[0].routePath).toBe('/:cluster/*');
  });
});
