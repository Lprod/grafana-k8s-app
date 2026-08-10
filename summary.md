# Session Summary — debeka-k8s-app (Grafana K8s Observability App Plugin)

**Repo:** https://github.com/Lprod/grafana-k8s-app (branch `main`)
**Current release:** `v1.1.1` (tagged and pushed; GitHub Actions release workflow builds it automatically, signing is disabled)
**Reference design:** https://play.grafana.org/a/grafana-k8s-app/navigation/cluster/... ("Grafana Play") — this plugin is being rebuilt to visually/functionally match Grafana's own official Kubernetes Monitoring app, tab by tab.

## Naming convention (use this when talking about pages)

- A top-level list page is named plainly: **Clusters**, **Nodes**, **Namespaces**, **Workloads**.
- Its detail/drilldown page (reached by clicking a row) is named "**\<Name\> Drilldown**", e.g. **Clusters Drilldown**.
- This is also saved in persistent memory (`feedback_page_naming.md`).

## What exists today

### Clusters (list page) — `src/scenes/clustersApp.tsx: getClustersListScene`
Table of all clusters (Cluster/Nodes/Alerts/CPU Avg/Avg%/Max/Max%/Mem Avg/Avg%/Max/Max%). Cluster column links to **Clusters Drilldown**; Nodes column links to **Nodes** page (per-row `var-cluster`). Thresholds: orange <60%, green 60–90%, red >90% (`usageThresholds` in clustersApp.tsx, and `usageTierFromFraction`/`usageColorFromTier` in `tableCells.tsx` for the icon+colored-text cells). All table columns are left-aligned.

### Clusters Drilldown — `getClusterDetailPage` in clustersApp.tsx
Tabbed page (Overview, CPU, Memory, Network Storage, Logs, Events, Alerts). Title renders as "\<cluster-name\> [cluster]" badge via `ClusterPageTitle`. Datasource picker + timepicker in page-level controls.

- **Overview tab** (`getClusterOverviewScene`) — **done**:
  - "See Namespaces" / "See Workloads" buttons (plain `Button` + `window.location.assign`, left-aligned, no icons — see Known Gotchas below for why not `<a href>`/`LinkButton`).
  - "Cluster information" heading → **Cluster Health banner** (`ClusterHealthBanner` in `clusterOverviewCards.tsx`, custom `Alert` success/warning/error, driven by `buildClusterHealthQuery` in `clusterOverviewQueries.ts`: 0=healthy/green, 1=degraded no user impact/yellow, 2=degraded user impact/red) → two custom `InfoCard` boxes (cluster info: name/nodes/provider — nodes count links to Nodes page; capacity: cpu/memory/disk).
  - "Cluster optimization" heading → two timeseries panels (Cluster CPU / Cluster Memory) showing Capacity (purple, 14% fill)/Limits (red dashed)/Requests (orange dashed)/Usage (blue solid), legend as a Min/Mean/Max table.
  - "Nodes" heading → node/legend row → **Nodes table** (per-node CPU/Mem Avg/Max, same styling as Clusters table).
- **CPU tab** (`getClusterCpuScene`) — **done**: `node`/`namespace` variable pickers, 3 "Efficiency" stat panels (Requests/Capacity, Usage/Capacity, Usage/Requests — colored + sparkline graph mode, same thresholds as tables), then the pre-existing "CPU usage" timeseries.
- **Memory/Network Storage/Logs/Events/Alerts tabs**: Memory has its original usage timeseries; Alerts has its original firing-alerts table; Network Storage/Logs/Events are still `getComingSoonScene` placeholders. **Not yet rebuilt to match Grafana Play** — this is the natural next step (mirror what was done for Overview/CPU).

### Nodes / Namespaces / Workloads (top-level pages)
`src/pages/{Nodes,Namespaces,Workloads}/*Page.ts` — stub pages (`getComingSoonScene`), each with the right variable set (Nodes: cluster+node; Namespaces: cluster+namespace; Workloads: cluster+namespace+workload) and registered in both `plugin.json` includes (nav) and `getClustersSceneApp()`'s `pages` array. No real content yet.

### Not attempted / explicitly deferred
- **Predictions/Actions column** (seen in Grafana Play's Nodes table) — user asked "is that a lot of effort", answer given but not built.
- **Grafana Assistant panel link with a custom prompt** — investigated deeply, **not viable**: app plugins cannot consume the `PluginExtensionPoints.DashboardPanelMenu` extension point (runtime rejects it with "should be prefixed with your plugin id"), and the assistant's auto-injected menu items use hardcoded prompt templates anyway. Do not re-attempt this without a new, different mechanism becoming available. Code was written, tested, found broken, and fully reverted.

## Known gotchas discovered this session (read before repeating work)

1. **Grafana Scenes cross-page variable collisions.** When several top-level `SceneApp` pages independently declare a same-named variable (e.g. every page has its own "cluster" variable), navigating between them via a normal `<a href>`/`LinkButton` can silently drop the intended `var-cluster` value (Scenes renames the destination's own variable to `var-cluster-2` etc. to avoid a URL key collision with the still-mounted source page). **Fix used:** for any link that must carry a variable value across pages, use a plain `Button` with `onClick={() => window.location.assign(url)}` (a real page reload) instead of `href`/`LinkButton` — this reliably resets Scenes' URL-key mapper. A `PanelBuilders.table()` per-row `overrideLinks(...)` (native `<a href>`) does **not** have this problem in practice as tested (Clusters table → Nodes column link works fine), only React-rendered custom buttons/links inside our own scenes hit it.
2. **`plugin.json` changes need a full Grafana *process* restart**, not just a rebuild — `podman restart` is not always enough if the backend already registered the plugin in-memory; when nav entries seem "stuck" on an old `plugin.json`, recreate the container (`podman rm -f` + `podman run ...`) rather than just restarting.
3. **Webpack build cache can go stale** when `node_modules` is a symlink shared with another checkout (I used `ln -s /opt/debeka-k8s-app/node_modules ./node_modules` in this worktree for fast local `typecheck`/`build`/`lint` without a full `npm install`). `node_modules/.cache/webpack` is shared too, and `CopyWebpackPlugin` can silently keep serving an old `plugin.json` even after `npm run build`. **Always `rm -rf node_modules/.cache/webpack` before trusting a build** if you use this symlink trick — this caused Namespaces/Workloads to vanish from the nav for a while and cost real debugging time. Remember to `rm -f node_modules` (the symlink) when done, so it never gets committed (it's gitignored, but stray in `git status` otherwise).
4. **The `kube-metrics-demo` container's bind-mounted file goes stale on edit.** It bind-mounts a single file (`demo/kube-metrics/metrics`), and this tool's file edits appear to replace-via-rename (changing the inode), which breaks a live single-file bind mount. After editing that file, `podman rm -f kube-metrics-demo` + `podman compose -f docker-compose.demo.yaml up -d kube-metrics-demo` (recreate, not restart) to pick it up.
5. **`podman-compose` + the webpack `extends:` pattern in `docker-compose.yaml`/`​.config/docker-compose-base.yaml` resolves relative volume paths wrong** (one directory too high) — don't trust `npm run server`/`podman compose -f docker-compose.yaml up` for the grafana container as-is in this environment; a manual `podman run` with explicit absolute bind-mount paths was used instead (see shell history / just reconstruct from `docker-compose-base.yaml`'s env/mounts).
6. **Verifying changes:** no `gh` CLI available in this sandbox. Visual verification was done via a `mcr.microsoft.com/playwright` container (chromium not runnable natively here — missing system libs, no sudo to install) driven with small throwaway scripts, screenshotting against the locally-run Grafana+Prometheus+demo-metrics stack (all on the `debeka-k8s-app-demo` podman network). This works well; reuse the pattern.

## Demo data (`demo/kube-metrics/metrics`)
Extended this session with: `namespace_cpu:kube_pod_container_resource_{limits,requests}:sum`, `namespace_memory:kube_pod_container_resource_{limits,requests}:sum`, `node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate`, plus synthetic `kube_job_status_*`/`kube_cronjob_labels`/`kube_node_status_condition` for the Cluster Health check (aws cluster is deliberately "degraded, no user impact"; gce is "healthy" — useful for screenshots). Only `demo-cluster-aws-node-1` / `demo-cluster-gce-node-1` have *real* node-exporter-backed metrics; the other synthetic nodes (aws has 3, gce has 2 in `kube_node_info`) show "no data" for usage metrics — this is expected, not a bug.

## Where to pick up next
Natural next step (following the established "tab by tab" pattern): rebuild **Memory**, then **Network Storage**, **Logs**, **Events**, **Alerts** tabs to match Grafana Play, the same way Overview and CPU were done — ask the user for the Grafana Play queries/panel layout for each, same as this session's CPU tab request.
