import { useEffect } from 'react';
import { BadgeColor } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { PLUGIN_BASE_URL, ROUTES } from '../constants';

// "Recently viewed" for the Search page's empty state (UX-13). Recorded from
// the URL of every drilldown the user actually lands on - however they got
// there (a list-page row, a link in another drilldown, Search itself, a
// pasted link) - not just from clicks on a Search suggestion, which would
// only ever remember what was found through Search.
//
// Lives in the viewer's own browser (localStorage): it's a per-person
// navigation convenience, never shared, and the page must render normally
// when storage is unavailable (private windows, blocked site data), so every
// access is wrapped.

export type RecentObjectKind = 'cluster' | 'node' | 'namespace' | 'workload' | 'pod' | 'cronjob' | 'job';

export interface RecentObject {
  kind: RecentObjectKind;
  name: string;
  cluster: string;
  // Namespace for namespaced objects, so two same-named objects in different
  // namespaces/clusters stay distinguishable in the list (same reason UX-11
  // added the cluster to Search's own suggestions).
  namespace?: string;
  // The object's drilldown *root* - no tab slug, no query string. A stored
  // `var-datasource`/time range would reopen the object against whatever
  // datasource was selected back then; landing on its Overview with the
  // current defaults is the predictable choice.
  path: string;
}

// Same entity-badge palette the drilldown page titles already use
// (cluster=blue, namespace=purple, node=darkgrey, pod=orange,
// cronjob=brand, job=red, workload=green) so an entry reads as the same kind
// of thing here as on its own page.
export const RECENT_KIND_BADGE: Record<RecentObjectKind, BadgeColor> = {
  cluster: 'blue',
  node: 'darkgrey',
  namespace: 'purple',
  workload: 'green',
  pod: 'orange',
  cronjob: 'brand',
  job: 'red',
};

const STORAGE_KEY = 'debeka-k8s-app.recentObjects';
const MAX_ENTRIES = 8;

const segmentsAfter = (pathname: string, route: string) => {
  const prefix = `${PLUGIN_BASE_URL}/${route}/`;
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  return pathname
    .slice(prefix.length)
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
};

const url = (route: string, ...parts: string[]) =>
  `${PLUGIN_BASE_URL}/${route}/${parts.map((p) => encodeURIComponent(p)).join('/')}`;

// Maps a drilldown URL - any of its tabs - back to the object it shows.
// Positional on purpose: every drilldown route here has a fixed number of
// identifying segments followed by an optional tab slug (see each page's own
// routePath), so e.g. `/nodes/<cluster>/<node>/cpu` is the node, not a node
// called "cpu". Returns undefined for list pages and anything else.
export function parseRecentObject(pathname: string): RecentObject | undefined {
  let s = segmentsAfter(pathname, ROUTES.Clusters);
  if (s && s.length >= 1) {
    return { kind: 'cluster', name: s[0], cluster: s[0], path: url(ROUTES.Clusters, s[0]) };
  }

  s = segmentsAfter(pathname, ROUTES.Nodes);
  if (s && s.length >= 2) {
    return { kind: 'node', name: s[1], cluster: s[0], path: url(ROUTES.Nodes, s[0], s[1]) };
  }

  s = segmentsAfter(pathname, ROUTES.Namespaces);
  if (s && s.length >= 2) {
    return { kind: 'namespace', name: s[1], cluster: s[0], path: url(ROUTES.Namespaces, s[0], s[1]) };
  }

  s = segmentsAfter(pathname, ROUTES.Workloads);
  if (s && s.length >= 4) {
    const [cluster, namespace, workloadType, workload] = s;
    // Pod Drilldown is nested under the Workload Drilldown's own route.
    if (s[4] === 'pods' && s.length >= 6) {
      return {
        kind: 'pod',
        name: s[5],
        cluster,
        namespace,
        path: url(ROUTES.Workloads, cluster, namespace, workloadType, workload, 'pods', s[5]),
      };
    }
    return {
      kind: 'workload',
      name: workload,
      cluster,
      namespace,
      path: url(ROUTES.Workloads, cluster, namespace, workloadType, workload),
    };
  }

  // Singular `cronjob`/`job` are the drilldowns; the All Jobs page's own
  // list tabs are the plural `cronjobs`/`jobs`, so there's no ambiguity.
  s = segmentsAfter(pathname, ROUTES.Jobs);
  if (s && (s[0] === 'cronjob' || s[0] === 'job') && s.length >= 4) {
    const [kind, cluster, namespace, name] = s as ['cronjob' | 'job', string, string, string];
    return { kind, name, cluster, namespace, path: url(ROUTES.Jobs, kind, cluster, namespace, name) };
  }

  return undefined;
}

export function loadRecentObjects(): RecentObject[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RecentObject[]) : [];
  } catch {
    return [];
  }
}

export function recordRecentObject(object: RecentObject) {
  try {
    // Most recent first; revisiting an object (or switching its tabs, which
    // parses to the same path) moves it to the top rather than duplicating it.
    const next = [object, ...loadRecentObjects().filter((o) => o.path !== object.path)].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable - a navigation convenience, not worth surfacing.
  }
}

// Mounted once in the app root: records the current page on load and on
// every in-app navigation after that.
export function useRecentObjectTracking() {
  useEffect(() => {
    const record = (pathname: string) => {
      const object = parseRecentObject(pathname);
      if (object) {
        recordRecentObject(object);
      }
    };
    record(locationService.getLocation().pathname);
    // Re-reads the location instead of using the listener's own argument:
    // that argument is `location` in history v4 but `{ action, location }` in
    // v5, and this should keep working whichever one Grafana ships.
    return locationService.getHistory().listen(() => record(locationService.getLocation().pathname));
  }, []);
}
