# Changelog

## 1.5.0

- Added a None/hour/day/week-before comparison picker to every timeseries panel on the Clusters Drilldown (CPU/Memory/Network/Storage/Overview tabs) and Alerts pages. It's a header action on each panel individually, not a single page-wide control - each panel toggles its own comparison independently. Rendered as a small ghost-style button (styled to match Grafana Play's own "Predict CPU usage" panel-header button) that opens a compact dropdown menu, rather than the framework's default full toolbar control. Table-only pages (Clusters, Namespaces, Workloads, Nodes) don't get it, since there's no timeseries to compare. New timeseries panels added to the Drilldown/Alerts pages pick it up automatically via `PanelTimeRangeCompare` (`src/scenes/panelTimeRangeCompare.tsx`).
- All pages' time pickers now default to the browser's local timezone instead of UTC.
- Added a Workload filter to the Workloads page, alongside the existing Cluster/Namespace filters. Row-filters the table client-side by the `workload` field, since that field only exists after the queries' own `label_replace` calls and can't be filtered with a PromQL selector the way cluster/namespace are. Its dropdown is sourced from the same expression the table itself uses to derive "workload" - the previous source (`kube_pod_owner{owner_name=...}`) only carries that label for ownerless pods, so it came back empty for every Deployment/DaemonSet/StatefulSet/Job. Sent as a single-line, comment-stripped query wrapped in `query_result(...)`: Grafana's `query_result(...)` wrapper-detection doesn't span newlines, so the original multi-line formatted expression fell through to being sent as a raw `match[]` series selector instead (which only accepts plain selectors, not aggregations/`label_replace`/`OR`), producing "invalid parameter \"match[]\": ... unexpected \"(\"".

## 1.4.0

- Added the Namespaces page: a table across all selected clusters (Cluster/Namespace/Workloads/Alerts/CPU Usage/Requests/Requests%/Mem Usage/Requests/Requests%/Limits/Limits%) with the same usage thresholds and colored-icon cells as the Clusters/Nodes tables. Cluster links to the Clusters Drilldown page; Workloads links to the (still stub) Workloads page; Alerts links to the Alerts page, both pre-filtered to that cluster and namespace.
- Added the Workloads page: a table across all selected clusters/namespaces (Cluster/Namespace/Workload/Type/Pods/CPU Usage/Requests/Requests%/Mem Usage/Requests/Requests%/Limits/Limits%). Pods shows "ready / desired" with a proportional colored bar (green when caught up, red when short), matching Grafana Play. Unlike the Nodes/Namespaces tables, a workload's identity is cluster+namespace+workload+type (names repeat across namespaces), so this table merges its 10 queries by every field they share instead of a single join key.

## 1.3.0

- Added the Nodes page: a table across all selected clusters (Cluster/Node/Alerts/CPU Avg/Avg%/Max/Max%/Mem Avg/Avg%/Max/Max%) with the same orange/green/red usage thresholds and colored-icon cells as the Clusters table. Cluster column links to the Clusters Drilldown page; Alerts column links to the Alerts page pre-filtered to that cluster and node.
- Fixed the Alerts table's "Investigate" button sending Grafana Assistant a prompt with blank alert details (cluster/severity/alertname/namespace/pod/container). It looked up the table's ALL-CAPS display names (`CLUSTER`, `SEVERITY`, ...), but Grafana's rename transform only sets a field's display name, not its underlying name - the button now reads the original lowercase field names.

## 1.2.2

- Clusters Drilldown Overview: fixed the "Cluster information" info cards rendering at uneven widths (a long cluster name could force the left card wider than the right one even though both were flex-equal) by giving both cards an explicit 50/50 width and wrapping long values instead of letting them force extra width.

## 1.2.1

- Fixed cross-page variable propagation: navigating between top-level pages (Clusters, Namespaces, Workloads, Nodes, Alerts) with a cluster/namespace/node/severity/alertname filter always showed "All" on the destination page, regardless of navigation method (drilldown links, table links, or a hard reload).
- Fixed a related regression where a filter value could "leak" back into a page you never explicitly filtered (e.g. returning to the Clusters list after visiting a cluster-filtered Alerts page could incorrectly show only one cluster).

## 1.2.0

- Clusters Drilldown CPU tab: added "by Namespace" and "by node" sections (3 timeseries panels + a table each), with p95/Last-value legend tables and dashed capacity threshold lines.
- Rebuilt the Memory tab to match the CPU tab's structure (Efficiency stats, by-Namespace/by-node sections).
- Added a Network tab (bandwidth/saturation, cluster-wide and by-node) and a Storage tab (ephemeral volume usage, PVC/PV bytes and inodes, PVC/PV status, throughput, IOPS), replacing the old combined "Network Storage" placeholder.
- Removed the Logs, Events, and Alerts tabs from the cluster drilldown page.
- Added a new top-level Alerts page: cluster/node/namespace/severity/alertname filters, firing-alert breakdowns by cluster/namespace/severity, and a table with an "Investigate" action per alert that opens Grafana Assistant with a root-cause-analysis prompt and the alert's context.
- The Clusters table's Alerts column and a new "N firing alerts" badge on the Cluster Overview page now link to the Alerts page, pre-filtered to that cluster.

## 1.1.1

- Clusters Drilldown Overview: moved the Cluster Health banner between "Cluster information" and the info cards; added a link from the "nodes count" value to the Nodes page.
- Clusters Drilldown Nodes table and Clusters table: switched thresholds to orange (<60%)/green (60-90%)/red (>90%) and made all table columns left-aligned.
- Added a Nodes page (stub, variables `cluster`/`node`) and linked it from the Clusters table's Nodes column.
- Clusters Drilldown CPU tab: added `node`/`namespace` variables and three "Efficiency" stat panels (Requests/Capacity, Usage/Capacity, Usage/Requests) with sparkline graph mode, using the same orange/green/red thresholds as the tables.
- Fixed a stale-build issue where `plugin.json` nav entries (Namespaces/Workloads) silently dropped out of the app's left-hand navigation.

## 1.1.0

- Redesigned the cluster drilldown page with tabs (Overview, CPU, Memory, Network Storage, Logs, Events, Alerts).
- Overview tab: Cluster Health banner, custom cluster information/capacity cards, and a Cluster optimization section (CPU/Memory capacity vs. limits/requests/usage).
- Added stub Namespaces and Workloads pages, linked from the Overview tab.

## 1.0.0

Initial release.
