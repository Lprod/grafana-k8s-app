# Changelog

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
