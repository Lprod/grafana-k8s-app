import { locationService } from '@grafana/runtime';
import { DataSourceVariable, SceneApp, SceneAppPage, SceneVariableSet } from '@grafana/scenes';
import { scopeThanosDatasourceVariable } from './thanosDatasourceScope';

function variable() {
  return scopeThanosDatasourceVariable(new DataSourceVariable({ name: 'datasource', pluginId: 'prometheus', value: 'prod' }));
}

function page(url: string, ds: DataSourceVariable) {
  return new SceneAppPage({ title: url, url, $variables: new SceneVariableSet({ variables: [ds] }) });
}

describe('scopeThanosDatasourceVariable', () => {
  const homeDs = variable();
  const clustersDs = variable();
  new SceneApp({ pages: [page('/a/app', homeDs), page('/a/app/clusters', clustersDs)] });

  beforeEach(() => window.sessionStorage.clear());

  it('gives only the current top-level page the plain URL key', () => {
    locationService.push('/a/app/clusters/some-cluster');
    expect(clustersDs.urlSync!.getKeys()).toEqual(['var-datasource']);
    expect(homeDs.urlSync!.getKeys()).toEqual([]);
    expect(homeDs.urlSync!.getUrlState()).toEqual({});

    // The home page's URL prefixes every other page's; it only wins on its own paths.
    locationService.push('/a/app/overview');
    expect(homeDs.urlSync!.getKeys()).toEqual(['var-datasource']);
    expect(clustersDs.urlSync!.getKeys()).toEqual([]);
  });

  it('keeps the plain key on pages outside the SceneApp (drilldowns)', () => {
    locationService.push('/a/app/overview');
    expect(variable().urlSync!.getKeys()).toEqual(['var-datasource']);
  });

  it('falls back to the remembered datasource when the URL has none', () => {
    const ds = variable();
    window.sessionStorage.setItem('debeka-k8s-app.thanosDatasource', 'test');
    ds.urlSync!.updateFromUrl({ 'var-datasource': null });
    expect(ds.state.value).toBe('test');

    // A datasource named in the URL wins.
    ds.urlSync!.updateFromUrl({ 'var-datasource': 'prod' });
    expect(ds.state.value).toBe('prod');
  });
});
