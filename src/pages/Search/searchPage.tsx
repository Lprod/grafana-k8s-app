import React, { useEffect, useMemo, useState } from 'react';
import {
  EmbeddedScene,
  SceneAppPage,
  SceneControlsSpacer,
  SceneDataTransformer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneQueryRunner,
  SceneReactObject,
  SceneRefreshPicker,
  SceneTimePicker,
  SceneTimeRange,
  SceneVariableSet,
  TextBoxVariable,
  VariableValueControl,
  PanelBuilders,
  FieldConfigOverridesBuilder,
} from '@grafana/scenes';
import { Alert, FilterPill, Icon, Input, useStyles2 } from '@grafana/ui';
import { DataFrame, GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { buildSearchTarget, SearchTableQueryKey } from '../../queries/searchQueries';
import {
  SEARCH_VARIABLE_NAME,
  THANOS_VARIABLE_NAME,
  createSearchTextVariable,
  createThanosDatasourceVariable,
} from '../../variables/datasourceVariables';
import { attachExploreMenus } from '../../scenes/panelExplore';

const SEARCH_URL = `${PLUGIN_BASE_URL}/${ROUTES.Search}`;
const CLUSTERS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Clusters}`;
const NODES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Nodes}`;
const NAMESPACES_URL = `${PLUGIN_BASE_URL}/${ROUTES.Namespaces}`;
const WORKLOADS_URL = `${PLUGIN_BASE_URL}/${ROUTES.Workloads}`;
const KUBERNETES_ICON = 'public/plugins/debeka-k8s-app/img/kubernetes.png';

// Same "escaped live variable token spliced into the query text" pattern as
// every list page's own clusterRegex/namespaceRegex - `${search:regex}` is
// resolved by Scenes' variable interpolation at query-run time, not here.
const searchRegex = `\${${SEARCH_VARIABLE_NAME}:regex}`;

type Category = SearchTableQueryKey;
type Row = Record<string, string>;

const CATEGORY_ORDER: Category[] = ['clusters', 'nodes', 'namespaces', 'workloads', 'pods', 'containers'];
const CATEGORY_LABELS: Record<Category, string> = {
  clusters: 'Clusters',
  nodes: 'Nodes',
  namespaces: 'Namespaces',
  workloads: 'Workloads',
  pods: 'Pods',
  containers: 'Containers',
};

const encode = (value: string) => encodeURIComponent(value);

function linkOverride(
  b: FieldConfigOverridesBuilder<any>,
  fieldName: string,
  displayName: string,
  url?: string
): FieldConfigOverridesBuilder<any> {
  const withName = b.matchFieldsWithName(fieldName).overrideDisplayName(displayName).overrideCustomFieldConfig('align', 'left');
  return url ? withName.overrideLinks([{ title: `View ${displayName.toLowerCase()}`, url }]) : withName;
}

// One definition per category: how to group/organize its columns for the
// committed table view, and how to resolve one matching row (from the same
// data) into an autocomplete suggestion - a primary name, an immediate-
// parent "secondary" line (mirrors Grafana Play's own Namespace suggestion,
// which shows the namespace's cluster underneath), and the URL a click on
// that suggestion navigates straight to (confirmed live against Grafana
// Play: selecting a suggestion opens that object's own Drilldown page, not a
// filtered view on this Search page).
interface CategoryDef {
  title: string;
  indexByName: Record<string, number>;
  primaryField: string;
  secondaryField?: string;
  buildSuggestionUrl: (row: Row) => string;
  buildOverrides: (b: FieldConfigOverridesBuilder<any>) => FieldConfigOverridesBuilder<any>;
}

const CATEGORY_DEFS: Record<Category, CategoryDef> = {
  clusters: {
    title: 'Clusters',
    indexByName: { cluster: 0 },
    primaryField: 'cluster',
    buildSuggestionUrl: (row) => `${CLUSTERS_URL}/${encode(row.cluster)}`,
    buildOverrides: (b) => linkOverride(b, 'cluster', 'Cluster', `${CLUSTERS_URL}/\${__value.text}\${__url.params}`),
  },
  nodes: {
    title: 'Nodes',
    indexByName: { node: 0, cluster: 1 },
    primaryField: 'node',
    secondaryField: 'cluster',
    buildSuggestionUrl: (row) => `${NODES_URL}/${encode(row.cluster)}/${encode(row.node)}`,
    buildOverrides: (b) => {
      const withNode = linkOverride(b, 'node', 'Node', `${NODES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}`);
      return linkOverride(withNode, 'cluster', 'Cluster', `${CLUSTERS_URL}/\${__value.text}\${__url.params}`);
    },
  },
  namespaces: {
    title: 'Namespaces',
    indexByName: { namespace: 0, cluster: 1 },
    primaryField: 'namespace',
    secondaryField: 'cluster',
    buildSuggestionUrl: (row) => `${NAMESPACES_URL}/${encode(row.cluster)}/${encode(row.namespace)}`,
    buildOverrides: (b) => {
      const withNamespace = linkOverride(b, 'namespace', 'Namespace', `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}`);
      return linkOverride(withNamespace, 'cluster', 'Cluster', `${CLUSTERS_URL}/\${__value.text}\${__url.params}`);
    },
  },
  workloads: {
    title: 'Workloads',
    indexByName: { workload: 0, workload_type: 1, namespace: 2, cluster: 3 },
    primaryField: 'workload',
    secondaryField: 'namespace',
    buildSuggestionUrl: (row) => `${WORKLOADS_URL}/${encode(row.cluster)}/${encode(row.namespace)}/${encode(row.workload_type)}/${encode(row.workload)}`,
    buildOverrides: (b) => {
      const withWorkload = linkOverride(
        b,
        'workload',
        'Workload',
        `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`
      );
      const withType = linkOverride(withWorkload, 'workload_type', 'Type');
      const withNamespace = linkOverride(
        withType,
        'namespace',
        'Namespace',
        `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}`
      );
      return linkOverride(withNamespace, 'cluster', 'Cluster', `${CLUSTERS_URL}/\${__value.text}\${__url.params}`);
    },
  },
  pods: {
    title: 'Pods',
    indexByName: { pod: 0, workload: 1, workload_type: 2, namespace: 3, cluster: 4 },
    primaryField: 'pod',
    secondaryField: 'workload',
    buildSuggestionUrl: (row) =>
      `${WORKLOADS_URL}/${encode(row.cluster)}/${encode(row.namespace)}/${encode(row.workload_type)}/${encode(row.workload)}/pods/${encode(row.pod)}`,
    buildOverrides: (b) => {
      // Pod Drilldown is nested under the Workload Drilldown's own route -
      // needs all five identifying fields, same as the Workload Overview
      // tab's own Pods table link (podsPage.tsx).
      const withPod = linkOverride(
        b,
        'pod',
        'Pod',
        `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__data.fields.workload}/pods/\${__value.text}\${__url.params}`
      );
      const withWorkload = linkOverride(
        withPod,
        'workload',
        'Workload',
        `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`
      );
      const withType = linkOverride(withWorkload, 'workload_type', 'Type');
      const withNamespace = linkOverride(
        withType,
        'namespace',
        'Namespace',
        `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}`
      );
      return linkOverride(withNamespace, 'cluster', 'Cluster', `${CLUSTERS_URL}/\${__value.text}\${__url.params}`);
    },
  },
  containers: {
    title: 'Containers',
    indexByName: { container: 0, pod: 1, workload: 2, workload_type: 3, namespace: 4, cluster: 5 },
    primaryField: 'container',
    secondaryField: 'pod',
    // No dedicated Container page/drilldown exists in this app - a
    // suggestion still needs somewhere useful to go, so it lands on the
    // container's own pod (same destination as the Containers table's own
    // Pod column link below).
    buildSuggestionUrl: (row) =>
      `${WORKLOADS_URL}/${encode(row.cluster)}/${encode(row.namespace)}/${encode(row.workload_type)}/${encode(row.workload)}/pods/${encode(row.pod)}`,
    buildOverrides: (b) => {
      const withContainer = linkOverride(b, 'container', 'Container');
      const withPod = linkOverride(
        withContainer,
        'pod',
        'Pod',
        `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__data.fields.workload}/pods/\${__value.text}\${__url.params}`
      );
      const withWorkload = linkOverride(
        withPod,
        'workload',
        'Workload',
        `${WORKLOADS_URL}/\${__data.fields.cluster}/\${__data.fields.namespace}/\${__data.fields.workload_type}/\${__value.text}\${__url.params}`
      );
      const withType = linkOverride(withWorkload, 'workload_type', 'Type');
      const withNamespace = linkOverride(
        withType,
        'namespace',
        'Namespace',
        `${NAMESPACES_URL}/\${__data.fields.cluster}/\${__value.text}\${__url.params}`
      );
      return linkOverride(withNamespace, 'cluster', 'Cluster', `${CLUSTERS_URL}/\${__value.text}\${__url.params}`);
    },
  },
};

function mergeAndOrganize(indexByName: Record<string, number>) {
  return [
    { id: 'merge', options: {} },
    { id: 'organize', options: { excludeByName: { Time: true, Value: true }, indexByName, renameByName: {} } },
  ];
}

// One query+transform pipeline per category - built once per "mount" (see
// SearchControls below) and reused for both the committed table view and
// the live autocomplete dropdown's row data, so typing only triggers one
// query per active category, not two.
function buildCategoryPipeline(category: Category) {
  const def = CATEGORY_DEFS[category];
  const queryRunner = new SceneQueryRunner({
    datasource: { uid: `\${${THANOS_VARIABLE_NAME}}` },
    queries: [buildSearchTarget(category, searchRegex)],
  });
  const transformedData = new SceneDataTransformer({ $data: queryRunner, transformations: mergeAndOrganize(def.indexByName) });
  const panel = PanelBuilders.table().setTitle(def.title).setData(transformedData).setOverrides(def.buildOverrides).build();
  return { transformedData, panel };
}

function framesToRows(series: DataFrame[] | undefined): Row[] {
  if (!series) {
    return [];
  }
  const rows: Row[] = [];
  for (const frame of series) {
    for (let i = 0; i < frame.length; i++) {
      const row: Row = {};
      for (const field of frame.fields) {
        row[field.name] = String(field.values[i] ?? '');
      }
      rows.push(row);
    }
  }
  return rows;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    wrapper: css({ position: 'relative' as const }),
    pills: css({ display: 'flex', gap: theme.spacing(1), flexWrap: 'wrap' as const, marginTop: theme.spacing(1) }),
    hint: css({ color: theme.colors.text.secondary, padding: theme.spacing(4, 0), textAlign: 'center' as const }),
    dropdown: css({
      position: 'absolute' as const,
      top: '100%',
      left: 0,
      right: 0,
      zIndex: theme.zIndex.dropdown,
      marginTop: theme.spacing(1),
      background: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      boxShadow: theme.shadows.z2,
      maxHeight: '70vh',
      overflowY: 'auto' as const,
    }),
    sectionHeader: css({
      padding: theme.spacing(1, 2),
      color: theme.colors.text.secondary,
      fontWeight: theme.typography.fontWeightMedium,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    row: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: theme.spacing(1, 2),
      background: 'none',
      border: 'none',
      textAlign: 'left' as const,
      cursor: 'pointer',
      '&:hover': { background: theme.colors.action.hover },
    }),
    primary: css({ color: theme.colors.text.primary }),
    secondary: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
    categoryTag: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  };
}

// Owns the search box, category filter pills, the live autocomplete dropdown
// shown while typing, and the committed table view shown after Enter -
// mirroring Grafana Play's own Search page (confirmed live via Playwright):
// - Typing (debounced into the "search" scene variable) keeps a per-category
//   query warm and renders a grouped, clickable suggestion list; clicking a
//   suggestion navigates straight to that object's own Drilldown page.
// - Enter commits the search: the dropdown closes and the same per-category
//   data renders as full tables below, but only for categories with at least
//   one matching row - not as empty "No data" tables.
// - If nothing matches anywhere once committed, a warning banner replaces
//   the tables ("No results found").
function SearchControls({ searchVariable, resultsLayout }: { searchVariable: TextBoxVariable; resultsLayout: SceneFlexLayout }) {
  const styles = useStyles2(getStyles);
  const [searchText, setSearchText] = useState('');
  const [selected, setSelected] = useState<Set<Category>>(new Set());
  const [committed, setCommitted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // `hasText`, not `searchText` itself, so this only changes reference on
  // the empty<->non-empty transition rather than on every keystroke -
  // `mountedCategories` should only change when *scope* actually changes
  // (pill toggle or that transition), not while the debounced "search"
  // variable is still catching up to what's being typed.
  const hasText = searchText.trim() !== '';
  const mountedCategories = useMemo(
    () => (!hasText ? [] : selected.size === 0 ? CATEGORY_ORDER : CATEGORY_ORDER.filter((c) => selected.has(c))),
    [hasText, selected]
  );

  // Pipelines are rebuilt only when the *set* of active categories changes
  // (pill toggle, or the empty<->non-empty transition) - not on every
  // keystroke, since the underlying SceneQueryRunners already re-run on
  // their own whenever the "search" variable changes.
  const pipelines = useMemo(() => {
    const built: Partial<Record<Category, ReturnType<typeof buildCategoryPipeline>>> = {};
    for (const category of mountedCategories) {
      built[category] = buildCategoryPipeline(category);
    }
    return built;
  }, [mountedCategories]);

  // Every mounted category's panel is genuinely rendered here (never
  // `isHidden`) so it stays properly reactive to the "search" variable -
  // confirmed live that a SceneFlexItem constructed with `isHidden: true`
  // never actually activates its body at all (SceneFlexItemRenderer's own
  // source renders `null` outright when hidden, skipping the normal
  // component-mount activation that wires up variable-dependency
  // subscriptions), and manually calling `.activate()` ourselves to
  // compensate does *not* fully replicate what that normal mount does -
  // the object updates its own `state.data` fine on the very first query,
  // but silently stops re-running when the variable later changes. Visually
  // hiding a mounted-but-not-yet-committed (or empty-result) category's
  // table instead uses a plain `height`/`overflow` CSS collapse (see
  // `updateVisibility` below) - a state change SceneFlexItemRenderer doesn't
  // treat as "don't render", so the component (and its query) stays alive.
  useEffect(() => {
    resultsLayout.setState({
      children: CATEGORY_ORDER.filter((c) => pipelines[c]).map((c) => new SceneFlexItem({ key: c, body: pipelines[c]!.panel })),
    });
  }, [pipelines, resultsLayout]);

  useEffect(() => {
    const handle = setTimeout(() => searchVariable.setValue(searchText), 400);
    return () => clearTimeout(handle);
  }, [searchText, searchVariable]);

  // Any edit to the query (new text, or a different category scope)
  // invalidates the last commit/dismissal - computed during render (the
  // React-recommended way to reset state in response to a changed input)
  // rather than in an effect, which would cause an extra render pass.
  const [prevInvalidationKey, setPrevInvalidationKey] = useState({ searchText, selected });
  if (prevInvalidationKey.searchText !== searchText || prevInvalidationKey.selected !== selected) {
    setPrevInvalidationKey({ searchText, selected });
    setCommitted(false);
    setDismissed(false);
  }

  // Live row data per mounted category - a plain subscribeToState loop
  // rather than calling useSceneObjectState per category (that would call a
  // hook a variable number of times as mountedCategories changes, breaking
  // React's rules of hooks). No manual `.activate()` needed - the panel
  // being genuinely mounted above already keeps this data source live.
  const [rowsByCategory, setRowsByCategory] = useState<Partial<Record<Category, Row[]>>>({});
  useEffect(() => {
    const apply = (category: Category) => () => {
      setRowsByCategory((prev) => ({ ...prev, [category]: framesToRows(pipelines[category]!.transformedData.state.data?.series) }));
    };
    const subs = Object.keys(pipelines).map((category) => {
      const c = category as Category;
      apply(c)();
      return pipelines[c]!.transformedData.subscribeToState(apply(c));
    });
    return () => subs.forEach((s) => s.unsubscribe());
  }, [pipelines]);

  // Every mounted category's table stays genuinely rendered the whole time
  // (see above); this only decides which ones are visually revealed - the
  // dropdown itself, not this, is what covers them up while typing.
  useEffect(() => {
    for (const category of CATEGORY_ORDER) {
      const item = resultsLayout.state.children.find((child) => child.state.key === category);
      if (item instanceof SceneFlexItem) {
        const visible = committed && (rowsByCategory[category]?.length ?? 0) > 0;
        item.setState({ height: visible ? '400px' : '0px', minHeight: 0 });
      }
    }
  }, [committed, rowsByCategory, resultsLayout]);

  const toggle = (category: Category) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const showDropdown = searchText.trim() !== '' && !committed && !dismissed;
  const totalMatches = committed ? mountedCategories.reduce((sum, c) => sum + (rowsByCategory[c]?.length ?? 0), 0) : -1;

  return (
    <div className={styles.wrapper}>
      <Input
        prefix={<Icon name="search" />}
        placeholder="Search Kubernetes objects... (Cluster, Namespace, Pod, Container, Node)"
        value={searchText}
        onChange={(e) => setSearchText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setCommitted(true);
          } else if (e.key === 'Escape') {
            setDismissed(true);
          }
        }}
      />
      <div className={styles.pills}>
        {CATEGORY_ORDER.map((category) => (
          <FilterPill key={category} label={CATEGORY_LABELS[category]} selected={selected.has(category)} onClick={() => toggle(category)} />
        ))}
      </div>
      {searchText.trim() === '' && <div className={styles.hint}>Type to search across your Kubernetes objects.</div>}
      {showDropdown && (
        <div className={styles.dropdown}>
          {mountedCategories
            .filter((category) => (rowsByCategory[category]?.length ?? 0) > 0)
            .map((category) => (
              <div key={category}>
                <div className={styles.sectionHeader}>{CATEGORY_DEFS[category].title}</div>
                {rowsByCategory[category]!.map((row, i) => {
                  const def = CATEGORY_DEFS[category];
                  return (
                    <button key={i} className={styles.row} onClick={() => window.location.assign(def.buildSuggestionUrl(row))}>
                      <div>
                        <div className={styles.primary}>{row[def.primaryField]}</div>
                        {def.secondaryField && <div className={styles.secondary}>{row[def.secondaryField]}</div>}
                      </div>
                      <span className={styles.categoryTag}>{def.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      )}
      {committed && totalMatches === 0 && (
        <Alert severity="warning" title="No results found">
          No results for current search query, try another query or change the time range.
        </Alert>
      )}
    </div>
  );
}

function getSearchScene(searchVariable: TextBoxVariable) {
  const resultsLayout = new SceneFlexLayout({ direction: 'column', children: [] });

  return new EmbeddedScene({
    $behaviors: [attachExploreMenus],
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({ reactNode: <SearchControls searchVariable={searchVariable} resultsLayout={resultsLayout} /> }),
        }),
        new SceneFlexItem({ body: resultsLayout }),
      ],
    }),
  });
}

export function getSearchPage() {
  // Constructed once here (not inside getScene, which re-runs on every
  // visit) and shared by reference into both the page's own $variables set
  // (for PromQL interpolation) and the SearchControls React component (for
  // reading/writing its value) - a plain JS reference passed as a prop, not
  // the "same scene object in two SceneObjectState slots" gotcha documented
  // elsewhere in this codebase (that's about re-parenting conflicts; a scene
  // variable read from a plain prop never gets reparented).
  const searchVariable = createSearchTextVariable();

  return new SceneAppPage({
    title: 'Search',
    subTitle: 'Find k8s objects, fast',
    titleImg: KUBERNETES_ICON,
    url: SEARCH_URL,
    routePath: `/${ROUTES.Search}/*`,
    getScene: () => getSearchScene(searchVariable),
    $timeRange: new SceneTimeRange({ from: 'now-1h', to: 'now', timeZone: 'browser' }),
    $variables: new SceneVariableSet({ variables: [createThanosDatasourceVariable(), searchVariable] }),
    controls: [
      new VariableValueControl({ variableName: THANOS_VARIABLE_NAME }),
      new SceneControlsSpacer(),
      new SceneTimePicker({}),
      new SceneRefreshPicker({ refresh: '1m' }),
    ],
    preserveUrlKeys: ['from', 'to', 'timezone', 'refresh', `var-${THANOS_VARIABLE_NAME}`],
  });
}
