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
    // Looked up by title, not by position: the Kubernetes home page was
    // added ahead of Clusters in the `pages` array in v1.7.0, which silently
    // broke this test's original `const [clustersPage] = ...` destructure.
    const clustersPage = sceneApp.state.pages.find((page) => page.state.title === 'Clusters');

    expect(clustersPage).toBeDefined();
    if (!clustersPage) {
      return;
    }
    expect(clustersPage.state.url).toBe('/a/debeka-k8s-app/clusters');
    expect(clustersPage.state.drilldowns).toHaveLength(1);
    expect(clustersPage.state.drilldowns?.[0].routePath).toBe('/:cluster/*');
  });
});
