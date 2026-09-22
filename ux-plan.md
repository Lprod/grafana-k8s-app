# UX-Plan — debeka-k8s-app

Gepflegter Stand des UX-Reviews vom 2026-09-20 (Rundgang gegen v2.0.6, Grafana 13.1.0, Demo-Stack). Diese Datei ist die **maßgebliche, aktuelle Fassung**. Die ursprüngliche Ausarbeitung mit Screenshots liegt eingefroren als Artifact: https://claude.ai/code/artifact/7c42b264-a07e-4440-8726-8c5f9fd9e050 (Stand v2.0.6, ohne Umsetzungsstatus).

Die IDs `UX-01`…`UX-19` (Befunde) und `F-01`…`F-12` (Feature-Ideen) sind stabil — der Nutzer bezieht sich im Gespräch darauf. Datei- und Zeilenangaben im Befundtext stammen von v2.0.6 und sind teils überholt; vor einer Umsetzung im Code gegenprüfen. Neue Entscheidungen hier nachtragen (Status + Begründung), nicht nur im Chat.

## Überblick

| ID | Befund | Schwere | Status |
|---|---|---|---|
| UX-01 | Tabellen laufen rechts aus dem Bild — ohne jeden Hinweis | Hoch | Gestrichen |
| UX-02 | Keine einzige Tabelle ist paginiert | Hoch | Umgesetzt · v2.3.0 |
| UX-03 | Keine Sortierung nach Dringlichkeit | Mittel | Umgesetzt · v2.3.0 |
| UX-04 | Panels in fester Höhe — bei vier Zeilen bleibt der halbe Bildschirm leer | Mittel | Gestrichen |
| UX-05 | Info-Cards zeigen rohe Metrik-Labelnamen | Hoch | Umgesetzt · v2.3.0 |
| UX-06 | CronJob- und Job-Drilldown zeigen die komplette PromQL in der Legende | Hoch | Umgesetzt · v2.3.0 |
| UX-07 | Der Node-Graph zeigt seine internen Feldnamen als Legende | Mittel | Umgesetzt · v2.3.0 (anders als geplant) |
| UX-08 | Cron-Ausdrücke bleiben unübersetzt | Niedrig | Gestrichen |
| UX-09 | Panel- und Spaltentitel werden abgeschnitten | Niedrig | Teilweise · v2.3.0 |
| UX-10 | Die Usage-Tier-Icons sind reinweiße PNGs | Hoch | Umgesetzt · v2.3.0 |
| UX-11 | Die Suche kann gleichnamige Objekte aus zwei Clustern nicht unterscheiden | Hoch | Umgesetzt · v2.4.0 |
| UX-12 | Kein Treffer-Highlighting, keine Tastaturbedienung | Mittel | Umgesetzt · v2.4.0 |
| UX-13 | Der leere Zustand der Suche ist ein Satz auf leerer Fläche | Mittel | Umgesetzt · v2.4.0 (reduziert) |
| UX-14 | Kein „diese Ansicht teilen“ | Niedrig | Umgesetzt · v2.3.0 |
| UX-15 | Drei von rund 35 Panels haben einen echten Leerzustand | Mittel | Teilweise · v2.3.0 |
| UX-16 | Kein Hinweis, wenn im gewählten Zeitraum keine Daten liegen | Mittel | Gestrichen |
| UX-17 | „Node is healthy“ direkt neben „1 firing alert“ | Niedrig | Umgesetzt · v2.4.0 |
| UX-18 | Sechs Tabs sind noch „coming soon“ | Mittel | Umgesetzt · v2.4.0 |
| UX-19 | Resource Simulator: Kachelraster überlappt, Startzustand ist leer | Niedrig | Umgesetzt · v2.4.0 (Diagnose korrigiert) |

| ID | Feature-Idee | Aufwand · Wirkung | Status |
|---|---|---|---|
| F-01 | Startseite als Handlungsliste statt als Zählerwand | Groß · Hoch | Abgelehnt |
| F-02 | Alert-Kontext: seit wann, was, und warum | Mittel · Hoch | Offen |
| F-03 | Trend-Sparklines in den Listenzellen | Mittel · Hoch | Offen |
| F-04 | Objekt-Sprung per Tastatur, überall | Mittel · Hoch | Offen |
| F-05 | Lauf-Historie als Streifen pro CronJob | Klein · Mittel | Offen |
| F-06 | Gespeicherte Ansichten | Mittel · Mittel | Offen |
| F-07 | Dependencies auf Namespace- und Workload-Ebene | Groß · Mittel | Offen |
| F-08 | Zwei Objekte nebeneinander vergleichen | Groß · Mittel | Offen |
| F-09 | Zeitvergleich für die ganze Seite | Klein · Mittel | Offen |
| F-10 | Kapazitäts-Prognose im Resource Simulator | Mittel · Mittel | Offen |
| F-11 | Tabellen exportieren | Klein · Niedrig | Offen |
| F-12 | Erstkontakt absichern | Klein · Niedrig | Offen |

## Was noch offen ist

- **Aus den Befunden:** die offenen Reste von UX-09 (Tooltips auf Grafanas Link-Zellen, „View detail"-Umbruch) und UX-15 (Leerzustand für Tabellen per Overlay statt `setNoValue`); bei UX-19 die zwei redundanten Quota-Tabellen im Simulator.
- **Feature-Ideen F-02 bis F-12** — keine davon angefangen, keine entschieden.

## Befunde

### UX-01 — Tabellen laufen rechts aus dem Bild — ohne jeden Hinweis

**Schwere:** Hoch · **Status:** Gestrichen

Im gesamten Quellcode setzen genau zwei Stellen eine Spaltenbreite (`ocCell.tsx:313`, `kubernetesOverviewScene.tsx:282`), `minWidth` kommt nirgends vor. Jede Tabelle verteilt ihre Spalten gleichmäßig. Ergebnis bei 1600 px: „Mem Avg“ wird zu „M…“. Bei 1280 px — also auf einem normalen Laptop — sind auf der Workloads-Seite **fünf von zehn Spalten unsichtbar**, darunter sämtliche Memory-Werte. Es gibt weder Scrollbalken-Hinweis noch Spaltenauswahl.

*Vorgeschlagener Fix (Plan):* Pro Spaltentyp `minWidth`/`width` setzen: Identitätsspalten (Cluster/Namespace/Workload/Node) großzügig, Meter-Zellen fix. Zusätzlich: Cluster- bzw. Namespace-Spalte ausblenden, sobald der zugehörige Filter auf genau einen Wert steht — das gibt ohne Informationsverlust zwei Spalten Breite zurück.

> **Umsetzung:** Vom Nutzer aus Phase 2 gestrichen. Billiger Teilersatz, falls das Thema wiederkommt: `frozenColumns.left` (existiert in Grafana 13.x) auf der Identitätsspalte.

### UX-02 — Keine einzige Tabelle ist paginiert

**Schwere:** Hoch · **Status:** Umgesetzt · v2.3.0

`enablePagination` kommt in keinem der rund 33 Table-Panels vor. Im Demo-Stack fällt das nicht auf — dort stehen 2 bis 9 Zeilen. In einer echten Umgebung mit hunderten Nodes und tausenden Pods wird aus jeder Listenseite ein unbegrenzter Scrollbereich in einem Panel fester Höhe, inklusive der Drilldown-Tabellen („Pods“, „Workloads“, „Runs“).

*Vorgeschlagener Fix (Plan):* `enablePagination` auf allen Listen- und Drilldown-Tabellen, kompaktere Zeilenhöhe, dazu eine sinnvolle Default-Sortierung (siehe UX-03).

> **Umsetzung:** `enablePagination` auf allen 35 Table-Panels.

### UX-03 — Keine Sortierung nach Dringlichkeit

**Schwere:** Mittel · **Status:** Umgesetzt · v2.3.0

Die Alerts-Tabelle listet critical, info, warning, warning — in Abfragereihenfolge, nicht nach Schweregrad. Die Listenseiten kommen in Metrik-Reihenfolge. Der Nutzer muss selbst suchen, was kaputt ist, obwohl die App die Information hat.

*Vorgeschlagener Fix (Plan):* Default-Sort „schlimmster Zustand zuerst“: Alerts nach Severity, Listenseiten nach höchster Auslastung bzw. nach Alert-Anzahl.

> **Umsetzung:** Über eine neue Transform `sortRowsByRank` (`tableCells.tsx`), nicht Grafanas `sortBy` (sortiert Strings nur alphabetisch). Alerts nach Severity; Clusters/Nodes/Namespaces nach Anzahl feuernder Alerts; **Workloads abweichend vom Plan nach fehlenden Replicas** statt CPU (die Tabelle hat keine Alerts-Spalte, Replicas sind ihr Gesundheitssignal). Stabil: Zeilen ohne Befund behalten ihre Reihenfolge. Achtung beim Nachbauen: die Transform muss auch die zeilenindizierten Arrays in `field.config.custom` mitsortieren.

### UX-04 — Panels in fester Höhe — bei vier Zeilen bleibt der halbe Bildschirm leer

**Schwere:** Mittel · **Status:** Gestrichen

Auf Clusters, Namespaces, Workloads und All Jobs füllt das Tabellen-Panel den Viewport, während darin vier Zeilen stehen. Rund 700 px tote Fläche pro Seite.

*Vorgeschlagener Fix (Plan):* Inhaltsabhängige Höhe mit Maximum — und den gewonnenen Platz für eine Zusammenfassungszeile über der Tabelle nutzen (siehe Feature F-01).

> **Umsetzung:** Nutzerentscheidung: „UX-02 löst es". Technischer Grund: `ySizing: 'content'` funktioniert nicht auf einem VizPanel (setzt nur `flexGrow: 0`; ein Panel hat keine natürliche Höhe). Paginierte Tabellen füllen die feste Höhe mit Zeilen.

### UX-05 — Info-Cards zeigen rohe Metrik-Labelnamen

**Schwere:** Hoch · **Status:** Umgesetzt · v2.3.0

Im Node-Drilldown steht wörtlich `node_container_runtime_version:`, `node_os_image:`, `vcf_esx_host:`, `clustername:`. Cluster-, Namespace-, Pod- und CronJob-Drilldown haben dasselbe Muster (`cluster name:`, `disk size:`, `egress ip:`, `next scheduled:`). Durchgängig klein geschrieben, mit Doppelpunkt, teils snake_case.

*Vorgeschlagener Fix (Plan):* Klartext-Beschriftungen in einer zentralen Map („Container-Runtime“, „Betriebssystem“, „Kubelet“, „ESXi-Host“, „Nächster Lauf“), einheitlich Title-Case und ohne Doppelpunkt. Rein mechanische Änderung, kein Query-Eingriff.

> **Umsetzung:** 47 Labels in 6 Dateien auf Klartext/Title-Case, Doppelpunkte entfernt.

### UX-06 — CronJob- und Job-Drilldown zeigen die komplette PromQL in der Legende

**Schwere:** Hoch · **Status:** Umgesetzt · v2.3.0

Die beiden „optimization“-Panels im Overview-Tab beider Seiten bauen ihre Queries nur aus `refId` und `expr` — ohne `legendFormat` (`jobsPage.tsx:558` ff.). Grafana fällt dann auf den rohen Ausdruck zurück. Jeder andere Drilldown macht es richtig (`clustersApp.tsx:405`: „Physical capacity of Cluster“), und auch die CPU-/Memory-Tabs derselben Seiten sind sauber beschriftet — es sind wirklich nur diese vier Panels.

*Vorgeschlagener Fix (Plan):* `legendFormat` je refId ergänzen, analog zu den bestehenden Panels, und die Panelhöhe so wählen, dass vier Legendenzeilen hineinpassen.

> **Umsetzung:** `legendFormat` wie bei Pod/Workload; Panelhöhe 300 → 400 (die war der Grund für die abgeschnittene Legendenzeile).

### UX-07 — Der Node-Graph zeigt seine internen Feldnamen als Legende

**Schwere:** Mittel · **Status:** Umgesetzt · v2.3.0 (anders als geplant)

Unter dem Dependencies-Graph steht die automatische Node-Graph-Legende mit `mainstat`, `secondarystat`, `arc__cpu_low`, `arc__mem_high`, `color` — also exakt den technischen Feldnamen, die für den Drei-Bucket-Ring-Trick gebraucht werden. Direkt darüber steht bereits eine handgeschriebene, verständliche Legende, die dasselbe erklärt.

*Vorgeschlagener Fix (Plan):* Die eingebaute Legende abschalten — die eigene Erklärzeile darüber ist die bessere und bereits vorhandene Lösung.

> **Umsetzung:** Die Node-Graph-Legende lässt sich **nicht abschalten** — das Panel-Schema hat keine `legend`-Option. Stattdessen haben alle beteiligten Felder einen `displayName`; die eingebaute Legende ist jetzt ein lesbarer Schlüssel.

### UX-08 — Cron-Ausdrücke bleiben unübersetzt

**Schwere:** Niedrig · **Status:** Gestrichen

Die Cronjobs-Tabelle und der CronJob-Drilldown zeigen `0 * * * *` und `*/15 * * * *`. Lesbar ist das nur für Leute, die Cron im Kopf haben.

*Vorgeschlagener Fix (Plan):* Klartext daneben oder als Tooltip: „stündlich zur vollen Stunde“, „alle 15 Minuten“. Der Ausdruck selbst bleibt sichtbar.

> **Umsetzung:** Nutzer: „Als IT-ler sollte man Cron lesen können!"

### UX-09 — Panel- und Spaltentitel werden abgeschnitten

**Schwere:** Niedrig · **Status:** Teilweise · v2.3.0

„Scheduling: Containers with CPU requests set (p…“, „Zero replica deploym…“, „CRONJOB (CONTROL…“. Auf der Kubernetes-Startseite bricht zusätzlich der „View detail“-Button in zwei Zeilen um, aber nur bei zwei der zwölf Kacheln — die Kachelreihe wirkt dadurch unruhig.

*Vorgeschlagener Fix (Plan):* Kürzere Titel, wo möglich, sonst Tooltip mit dem vollen Text; die Kachelbreite so wählen, dass der Button nie umbricht.

> **Umsetzung:** Nutzervorgabe: Texte **nicht** kürzen, nur Tooltips. Panel-Titel und Spaltenköpfe hatten bereits native Tooltips von Grafana; die app-eigenen Zellrenderer haben jetzt ein `title`. **Offen:** Grafanas Link-Zellen zeigen als Tooltip den Link-Titel („View node") statt des vollen Werts; der Umbruch des „View detail"-Buttons auf zwei Kacheln der Startseite ist nicht behoben.

### UX-10 — Die Usage-Tier-Icons sind reinweiße PNGs

**Schwere:** Hoch · **Status:** Umgesetzt · v2.3.0

`src/img/usage-low.png`, `-med` und `-high` bestehen nachgemessen zu 100 % aus weißen Pixeln. Auf dem dunklen Tabellenhintergrund funktionieren sie, im Light-Theme sind sie unsichtbar — in jeder CPU-/Memory-Zelle auf Clusters, Nodes, Namespaces, Workloads und in allen Drilldown-Tabellen, und ebenso in der Erklärzeile „Resource usage: low / med / high“ oben rechts. Der Nutzer verliert genau das Signal, das die Zelle auf einen Blick lesbar macht.

> **Umsetzung:** Inline-SVG in Tier-Farbe statt weißer PNGs; `src/img/usage-*.png` gelöscht.

### UX-11 — Die Suche kann gleichnamige Objekte aus zwei Clustern nicht unterscheiden

**Schwere:** Hoch · **Status:** Umgesetzt · v2.4.0

Die Vorschlagsliste zeigt Name und unmittelbaren Parent. Für Workloads ist der Parent der Namespace — also erscheinen die beiden `app`-Deployments aus `demo-cluster-aws` und `demo-cluster-gce` als zwei identische Zeilen „app / default“. Ein Klick führt in einen der beiden Cluster, und der Nutzer kann vorher nicht erkennen, in welchen. In einer Multi-Cluster-Umgebung — dem Normalfall dieser App — ist das der Hauptanwendungsfall der Seite.

*Vorgeschlagener Fix (Plan):* Den Cluster als zweite Kontextangabe in die Zeile aufnehmen (`default · demo-cluster-aws`) — die Daten liegen in der Query bereits vor.

> **Umsetzung:** Cluster als zweite Kontextangabe in jedem Vorschlag.

### UX-12 — Kein Treffer-Highlighting, keine Tastaturbedienung

**Schwere:** Mittel · **Status:** Umgesetzt · v2.4.0

Der eingetippte Teilstring wird in den Vorschlägen nicht hervorgehoben, kein Eintrag ist vorausgewählt, Pfeiltasten tun nichts, und dass Enter die Suche festschreibt (statt den ersten Treffer zu öffnen), erfährt man nur durch Ausprobieren.

*Vorgeschlagener Fix (Plan):* Treffer fett auszeichnen, Pfeil-hoch/runter + Enter auf die Liste legen, aktive Zeile hervorheben und eine dezente Hinweiszeile („↑↓ navigieren · ↵ alle Treffer anzeigen“) anfügen.

> **Umsetzung:** Pfeiltasten, Enter öffnet die Auswahl (ohne Auswahl weiterhin: alle Ergebnisse als Tabellen), Esc, Hinweiszeile, ARIA-Combobox. Highlighting case-sensitiv wie die Queries; `fontWeightBold` (500) war unsichtbar → 700 + Primärfarbe.

### UX-13 — Der leere Zustand der Suche ist ein Satz auf leerer Fläche

**Schwere:** Mittel · **Status:** Umgesetzt · v2.4.0 (reduziert)

„Type to search across your Kubernetes objects.“ — darunter 800 px nichts. Die erste Seite der App (Search steht in der Navigation ganz oben) bietet ohne Eingabe keinerlei Einstieg.

*Vorgeschlagener Fix (Plan):* Zuletzt besuchte Objekte (lokal gespeichert) und, sofern vorhanden, die Objekte mit aktiven Alerts als Einstiegs-Kacheln anbieten.

> **Umsetzung:** Nur „Recently viewed" (bis 8 Einträge, localStorage, erfasst aus jeder Drilldown-URL über `useRecentObjectTracking` im App-Root, `src/scenes/recentObjects.ts`). „Objekte mit aktiven Alerts" als Einstieg ist **nicht** umgesetzt.

### UX-14 — Kein „diese Ansicht teilen“

**Schwere:** Niedrig · **Status:** Umgesetzt · v2.3.0

Filter und Zeitraum stehen sauber in der URL — genutzt wird das aber nirgends. Wer einem Kollegen genau diese gefilterte Ansicht schicken will, muss die Adresszeile kopieren. Die `oc`-Kopierschaltfläche pro Zeile zeigt, dass das Muster in der App bereits etabliert ist.

*Vorgeschlagener Fix (Plan):* Ein „Link kopieren“-Button in der Seitenkopfzeile, analog zur `oc`-Zelle.

> **Umsetzung:** `copyLinkControl()` in allen 16 Toolbars; Clipboard-Helfer aus `ocCell.tsx` nach `scenes/copyLink.tsx` ausgelagert.

### UX-15 — Drei von rund 35 Panels haben einen echten Leerzustand

**Schwere:** Mittel · **Status:** Teilweise · v2.3.0

`setNoValue`/`noValue` wird nur in `kubernetesEfficiencyScene`, `kubernetesOverviewScene` und `nodeDependenciesScene` verwendet. Überall sonst erscheint Grafanas nacktes „No data“. Besonders schief wirkt das auf der Startseite: Die Kachel „Restarting containers“ zeigt ein riesiges grünes „No data“, während ihre elf Nachbarkacheln Zahlen zeigen — gemeint ist „0“, gelesen wird „kaputt“.

*Vorgeschlagener Fix (Plan):* Für Zählkacheln `noValue: '0'` statt „No data“; für Tabellen je einen konkreten Satz, wie es die Efficiency-Tabellen bereits vormachen („All containers have resource requests set.“).

> **Umsetzung:** Nur die Zählkacheln: `0` statt „No data". **Tabellen-Leerzustände zurückgenommen**: `setNoValue` auf einem Table-Panel greift pro *leerer Zelle*, nicht nur bei leerer Tabelle. Ein echter Tabellen-Leerzustand bräuchte eine Overlay-Komponente — offen.

### UX-16 — Kein Hinweis, wenn im gewählten Zeitraum keine Daten liegen

**Schwere:** Mittel · **Status:** Gestrichen

Beim Rundgang zeigten die Optimization-Charts 55 von 60 Minuten leere Achse und ganz rechts einen Datenstreifen. Die Ursache war hier der frisch gestartete Demo-Prometheus — in Produktion ist es dieselbe Situation nach einem Thanos-Ausfall, nach einem Cluster-Neuzugang oder bei einem zu weit zurückreichenden Zeitraum. Die App sagt in keinem dieser Fälle etwas; sie sieht schlicht kaputt aus.

*Vorgeschlagener Fix (Plan):* Wenn Daten nur einen Bruchteil des Fensters abdecken: eine dezente Zeile „Daten erst ab 18:40 · Zeitraum anpassen“ mit Ein-Klick-Korrektur auf den tatsächlich abgedeckten Bereich.

> **Umsetzung:** Vom Nutzer aus Phase 2 gestrichen.

### UX-17 — „Node is healthy“ direkt neben „1 firing alert“

**Schwere:** Niedrig · **Status:** Umgesetzt · v2.4.0

Das ist technisch korrekt — der Node-Banner liest `kube_node_status_condition`, der Button zählt Alerts — aber als Aussage widersprüchlich. Der Nutzer sieht grün und rot in einer Zeile und weiß nicht, was nun gilt.

*Vorgeschlagener Fix (Plan):* Entweder die Aussage präzisieren („Node-Bedingungen in Ordnung“ statt „Node is healthy“) oder aktive Alerts in die Banner-Severity einrechnen, wie es der Namespace-Banner bereits tut.

> **Umsetzung:** Nutzerwahl „nur umformulieren": „Node conditions OK" statt „Node is healthy". Alerts fließen bewusst **nicht** in die Banner-Severity ein.

### UX-18 — Sechs Tabs sind noch „coming soon“

**Schwere:** Mittel · **Status:** Umgesetzt · v2.4.0

Logs und Events im Node-Drilldown (`nodesPage.tsx:706–707`), im CronJob-Drilldown und im Job-Drilldown (`jobsPage.tsx:1311–1312`, `1371–1372`). Namespace-, Workload- und Pod-Drilldown haben beide Tabs vollständig — die Bausteine dafür (`logPanels.tsx`, `logsEventsLevelToggle.tsx`) sind also bereits geteilt und einsatzbereit. Zusätzlich fehlen CronJob und Job die Tabs Network und Storage ganz.

*Vorgeschlagener Fix (Plan):* Für CronJob/Job direkt umsetzbar (Filterung über `orchestrator.resource.name` wie beim Workload-Drilldown). Für den Node-Drilldown ist laut `summary.md` offen, ob die echten Elasticsearch-Daten ein node-identifizierendes Feld haben — siehe Rückfrage 2.

> **Umsetzung:** Logs/Events auf Node, CronJob, Job. Node über `k8s.node.name` (vom Nutzer bestätigt: das Feld existiert in der echten ES), Events zusätzlich über `orchestrator.resource.name` = Node-Name. CronJob/Job über den `orchestrator.resource.name`-Präfix wie beim Workload. CronJob/Job haben dafür den Logs-Datasource-Picker bekommen. Gemeinsame Fabrik `getRawLogsTabScene` in `logPanels.tsx`.

### UX-19 — Resource Simulator: Kachelraster überlappt, Startzustand ist leer

**Schwere:** Niedrig · **Status:** Umgesetzt · v2.4.0 (Diagnose korrigiert)

Die elf Quota-Kacheln haben unterschiedliche Breiten und brechen so um, dass das „Unlimited“-Badge der PVC-Kachel über dem Titel der ConfigMap-Kachel liegt. Zusätzlich startet die Seite auf einem Namespace ohne Workloads, sodass der erste Eindruck der Leerzustand ist — und darunter dieselben elf Ressourcen noch zweimal als Tabelle, komplett mit Nullen.

*Vorgeschlagener Fix (Plan):* Festes Grid mit gleicher Kachelbreite; Namespace-Vorauswahl auf den ersten mit Workloads; die beiden Tabellen zu einer zusammenführen oder die zweite einklappbar machen.

> **Umsetzung:** Das Raster war nicht ungleichmäßig. Ursache war der Kartenkopf: ein langes Label schob das Badge über den Rand (Flex-Default `min-width: auto`). Der leere Start kam vom alphabetisch ersten Namespace; eigene Simulator-Variable sortiert nach Deployment+StatefulSet-Anzahl. Die beiden redundanten Tabellen sind unverändert.

## Feature-Ideen

### F-01 Startseite als Handlungsliste statt als Zählerwand

**Aufwand · Wirkung:** Groß · Hoch · **Status:** Abgelehnt

Zwölf gleich aussehende Kacheln, die alle „1“ in Rot zeigen, priorisieren nichts. Darunter eine Liste „Das ist gerade kaputt“: betroffenes Objekt, Problemart, seit wann, direkter Link — die zwölf Queries dafür laufen bereits, nur das Detail-Dropdown versteckt sie hinter einer Auswahl.

> **Entscheidung:** Nutzer (2026-09-22): „Ne finde ich blöd." Gilt auch für die Zwischenstufe (Kacheln sortieren/abdunkeln). Technischer Hintergrund, falls es doch wiederkommt: die 12 Issue-Queries gruppieren nach unterschiedlichen Labelsets (Deployment/Node/Pod/Container) → bräuchte eine normalisierende Transform; „seit wann" ist aus diesen Queries nicht ableitbar; 12 schwere Detail-Queries pro Seitenaufruf statt 12 `count()` + 1.

### F-02 Alert-Kontext: seit wann, was, und warum

**Aufwand · Wirkung:** Mittel · Hoch · **Status:** Offen

Die Alerts-Tabelle zeigt Cluster, Severity, Name, Node, Namespace, Pod, Workload — aber nicht die Dauer („firing seit 14:02, 3 h“), nicht die Summary/Description aus dem Alert-Label und keinen Link zur Regel. Das sind die drei ersten Fragen jedes Bereitschaftsdienstes.

### F-03 Trend-Sparklines in den Listenzellen

**Aufwand · Wirkung:** Mittel · Hoch · **Status:** Offen

„95 %“ ist etwas anderes, wenn es seit zwei Stunden steigt, als wenn es seit zwei Tagen konstant ist. Die kombinierten Meter-Zellen (`requestUsageCell`) haben bereits Platz und Struktur dafür. War schon einmal vorgeschlagen und nie gebaut.

### F-04 Objekt-Sprung per Tastatur, überall

**Aufwand · Wirkung:** Mittel · Hoch · **Status:** Offen

Die Search-Seite kann bereits alles Nötige. Als Overlay auf jeder Seite (eigener Shortcut, nicht Grafanas ctrl+k) wird daraus der schnellste Weg zwischen zwei Objekten — heute führt jeder Wechsel über Navigation, Liste, Filter, Klick.

### F-05 Lauf-Historie als Streifen pro CronJob

**Aufwand · Wirkung:** Klein · Mittel · **Status:** Offen

Ein kompakter Balkenstreifen der letzten N Läufe (grün/rot/gelb) plus Erfolgsquote direkt in der Cronjobs-Tabelle. Die Daten liegen in der „Runs“-Query des Drilldowns bereits vor; heute muss man pro CronJob einmal hineinklicken.

### F-06 Gespeicherte Ansichten

**Aufwand · Wirkung:** Mittel · Mittel · **Status:** Offen

Filterkombination plus Zeitraum unter einem Namen sichern und in der Navigation oder auf der Search-Seite wieder anbieten — „Prod, nur kritische Namespaces“. Der Zustand steht bereits vollständig in der URL, es fehlt nur die Ablage.

### F-07 Dependencies auf Namespace- und Workload-Ebene

**Aufwand · Wirkung:** Groß · Mittel · **Status:** Offen

Der Node-Graph im Node-Drilldown ist das Alleinstellungsmerkmal dieser App gegenüber jedem Standard-Dashboard. Dieselbe Darstellung eine Ebene höher (Workload → Pod → Node → ESXi) beantwortet die Frage „wen reißt dieser Host mit?“, die sonst niemand beantwortet.

### F-08 Zwei Objekte nebeneinander vergleichen

**Aufwand · Wirkung:** Groß · Mittel · **Status:** Offen

Zwei Nodes oder zwei Workloads in einer geteilten Ansicht. „Warum ist `app` auf gce langsamer als auf aws?“ ist heute ein Wechsel zwischen zwei Tabs und ein Gedächtnistest.

### F-09 Zeitvergleich für die ganze Seite

**Aufwand · Wirkung:** Klein · Mittel · **Status:** Offen

Das Compare-Badge sitzt heute an jedem einzelnen Panel. Ein Schalter in der Seitenkopfzeile, der alle Panels gleichzeitig gegen „gestern“ oder „letzte Woche“ legt, macht aus einer Einzelfunktion einen Arbeitsmodus.

### F-10 Kapazitäts-Prognose im Resource Simulator

**Aufwand · Wirkung:** Mittel · Mittel · **Status:** Offen

Die Seite rechnet heute Szenarien gegen den Ist-Stand. Eine Fortschreibung des beobachteten Wachstums („bei aktuellem Trend ist das CPU-Quota in 12 Tagen voll“) macht aus dem Was-wäre-wenn eine Warnung.

### F-11 Tabellen exportieren

**Aufwand · Wirkung:** Klein · Niedrig · **Status:** Offen

CSV-Download pro Tabelle. Kommt erfahrungsgemäß immer dann auf, wenn jemand eine Auswertung in ein Ticket oder eine Präsentation heben muss.

### F-12 Erstkontakt absichern

**Aufwand · Wirkung:** Klein · Niedrig · **Status:** Offen

Wenn die erwarteten Datasources fehlen oder ungesund sind, zeigt die App heute leere Panels. Ein klarer Hinweis mit Link auf die Configuration-Seite spart den ersten Support-Fall.
