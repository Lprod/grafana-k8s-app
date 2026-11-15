import { locationService } from '@grafana/runtime';
import { SceneApp, SceneAppPage, SceneObject, SceneObjectUrlValues, MultiValueVariable } from '@grafana/scenes';

// Keeps the Thanos datasource choice (Prod / Test) when the user follows a
// link to another page of the app. Two separate problems used to drop it:
//
// 1. URL key suffixing. Every top-level page declares its own "datasource"
//    variable, and SceneAppPage constructs all of them up front as children of
//    the one SceneApp. Scenes' UniqueUrlKeyMapper sees nine same-named
//    variables in that tree and gives every page but the first a suffixed key:
//    on Clusters the picker wrote `var-datasource-3`, on Namespaces
//    `var-datasource-5`, and so on. A `${__url.params}` link from such a page
//    carried the suffixed key to a drilldown, whose own variable reads plain
//    `var-datasource` - so it fell back to the default datasource. The pages'
//    `preserveUrlKeys` (`var-datasource`) missed the suffixed key for the same
//    reason. Fix: a top-level page's variable only takes part in URL sync
//    while its page is the one in the address bar, so it is the only one the
//    key mapper finds and gets the plain key.
//
// 2. Links that never carried the datasource at all: the "View nodes"/"View
//    alerts" table links, the cluster/namespace title links, the health
//    banners' alert links, the left nav, Search results, the `/` jump overlay
//    and "Recently viewed". Fix: the last chosen datasource is remembered for
//    the browser tab, and a page whose URL has no `var-datasource` starts with
//    that one instead of the configured default. A URL that does name a
//    datasource still wins, so shared links open exactly what they say.

const STORAGE_KEY = 'debeka-k8s-app.thanosDatasource';

export function rememberedThanosDatasource(): string | undefined {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function rememberThanosDatasource(value: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Private mode / blocked storage: links then fall back to the default, as before.
  }
}

// The top-level SceneAppPage `obj` belongs to, or undefined on a drilldown
// page (those are created per URL and never parented to the SceneApp, so
// their variables have no same-named siblings to collide with).
function topLevelPageOf(obj: SceneObject): { page: SceneAppPage; app: SceneApp } | undefined {
  let current: SceneObject | undefined = obj;
  while (current?.parent) {
    if (current.parent instanceof SceneApp && current instanceof SceneAppPage) {
      return { page: current, app: current.parent };
    }
    current = current.parent;
  }
  return undefined;
}

function matchesPath(pageUrl: string, pathname: string): boolean {
  return pathname === pageUrl || pathname.startsWith(`${pageUrl}/`);
}

// True unless `obj` sits on a top-level page other than the one in the
// address bar. The home page's URL is the plugin root and prefixes every
// other page's, so the longest matching page URL wins.
function isOnCurrentPage(obj: SceneObject): boolean {
  const owner = topLevelPageOf(obj);
  if (!owner) {
    return true;
  }
  // Without Grafana's appSubUrl, like the pages' own `url`s.
  const pathname = locationService.getLocation().pathname;
  let bestUrl: string | undefined;
  for (const page of owner.app.state.pages) {
    if (matchesPath(page.state.url, pathname) && (!bestUrl || page.state.url.length > bestUrl.length)) {
      bestUrl = page.state.url;
    }
  }
  return bestUrl === owner.page.state.url;
}

export function scopeThanosDatasourceVariable<T extends MultiValueVariable>(variable: T): T {
  const handler = variable.urlSync;
  if (!handler) {
    return variable;
  }
  const getKeys = handler.getKeys.bind(handler);
  const getUrlState = handler.getUrlState.bind(handler);
  const updateFromUrl = handler.updateFromUrl.bind(handler);
  const key = `var-${variable.state.name}`;

  handler.getKeys = () => (isOnCurrentPage(variable) ? getKeys() : []);
  handler.getUrlState = () => (isOnCurrentPage(variable) ? getUrlState() : {});
  // Called with a null value when the URL has no `var-datasource`, before
  // Scenes writes the variable's current value back into the URL.
  handler.updateFromUrl = (values: SceneObjectUrlValues) => {
    const remembered = rememberedThanosDatasource();
    if (values[key] == null && remembered) {
      updateFromUrl({ ...values, [key]: remembered });
      return;
    }
    updateFromUrl(values);
  };

  variable.addActivationHandler(() => {
    const save = (value: unknown) => {
      if (typeof value === 'string' && value !== '') {
        rememberThanosDatasource(value);
      }
    };
    save(variable.getValue());
    const sub = variable.subscribeToState((next, prev) => {
      if (next.value !== prev.value) {
        save(next.value);
      }
    });
    return () => sub.unsubscribe();
  });
  return variable;
}
