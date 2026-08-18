import json
import os
import random
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ES_URL = os.environ.get("ES_URL", "http://elasticsearch:9200")

clusters = ["demo-cluster-aws", "demo-cluster-gce"]
namespaces = ["default", "cluster-tests"]
levels = ["info", "info", "info", "warn", "error"]
messages = [
    "pod scheduled successfully",
    "readiness probe succeeded",
    "liveness probe failed, restarting container",
    "image pull backoff",
    "node became NotReady",
    "evicted pod due to memory pressure",
    "scaled deployment replicas",
    "leader election won",
]

# Namespace Drilldown's "Logs / Events" bar charts (see
# src/queries/namespaceOverviewQueries.ts) read a different, ECS/OpenShift
# cluster-logging-style field schema than the generic docs above - keeping
# both means the pre-existing "demo-logs-*" datasource still has *some*
# documents even before this feature existed, while these new ones give the
# new panels something real to render. Deliberately mixes casing/spelling
# per field (ERROR/Error/ERR, WARN/Warning, ...) since the panels' color
# matching is built to tolerate that (matching what's seen in real log
# pipelines that aggregate from multiple sources).
log_levels = ["INFO", "INFO", "INFO", "DEBUG", "WARN", "Warning", "ERROR", "Err", "ALERT", "Trace"]
event_types = ["Normal", "Normal", "Normal", "Warning", "Error", "notice"]
event_reasons = [
    "Scheduled",
    "Pulled",
    "Created",
    "Started",
    "BackOff",
    "Unhealthy",
    "FailedMount",
    "Killing",
]

# Workload Drilldown Overview tab's "Logs / Events" section (see
# buildWorkloadLogsLevelQueries/buildWorkloadEventsLevelQueries in
# namespaceOverviewQueries.ts) filters on orchestrator.namespace/
# orchestrator.resource.name - most log/event documents don't carry a
# dedicated "workload" field, so the workload-scoped queries match on the
# resource (pod) name prefix instead. Reuses the same pod names the
# Prometheus side of this demo already models (namespace_workload_pod:
# kube_pod_owner:relabel in demo/kube-metrics/metrics) so a workload's logs/
# events line up with its own metrics.
workload_pod_names = {
    "demo-cluster-aws": ["app-aws", "node-agent-0-aws", "cache-0-aws", "db-migrate-1-aws", "debug-shell-aws"],
    "demo-cluster-gce": ["app-gce", "node-agent-0-gce", "cache-0-gce", "db-migrate-1-gce", "debug-shell-gce"],
}

print(f"Waiting for Elasticsearch at {ES_URL}...")
while True:
    try:
        with urllib.request.urlopen(ES_URL, timeout=5) as resp:
            if resp.status == 200:
                break
    except (urllib.error.URLError, ConnectionError):
        pass
    time.sleep(2)

# logmgmt.kind/logmgmt.category/k8s.cluster.name/k8s.namespace.name/
# log.level/event.type must be "keyword" (exact-match, unanalyzed), not
# Elasticsearch's default dynamic "text" mapping - a text field's terms
# aggregation is disabled without fielddata enabled, which would break the
# Logs/Events panels' whole "group by term" query shape. Set explicitly
# before any document using these fields is indexed, since a field's
# mapping can't be changed after the fact, only added to.
demo_logs_mapping_properties = {
    "logmgmt": {"properties": {"kind": {"type": "keyword"}, "category": {"type": "keyword"}}},
    "k8s": {
        "properties": {
            "cluster": {"properties": {"name": {"type": "keyword"}}},
            "namespace": {"properties": {"name": {"type": "keyword"}}},
        }
    },
    "log": {"properties": {"level": {"type": "keyword"}}},
    "event": {"properties": {"type": {"type": "keyword"}, "reason": {"type": "keyword"}}},
    "orchestrator": {"properties": {"namespace": {"type": "keyword"}, "resource": {"properties": {"name": {"type": "keyword"}}}}},
}

mapping_req = urllib.request.Request(
    f"{ES_URL}/demo-logs-000001/_mapping",
    data=json.dumps({"properties": demo_logs_mapping_properties}).encode("utf-8"),
    method="PUT",
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(mapping_req, timeout=10) as resp:
        print(f"Mapping update response: {resp.status}")
except urllib.error.HTTPError as e:
    # Index doesn't exist yet on a first-ever run - create it with the
    # mapping directly instead of PUT-ing onto a nonexistent index.
    if e.code == 404:
        create_req = urllib.request.Request(
            f"{ES_URL}/demo-logs-000001",
            data=json.dumps({"mappings": {"properties": demo_logs_mapping_properties}}).encode("utf-8"),
            method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(create_req, timeout=10) as resp:
            print(f"Index create response: {resp.status}")
    else:
        raise

now = datetime.now(timezone.utc)
lines = []
for i in range(200):
    ts = now - timedelta(seconds=i * 15)
    doc = {
        "@timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "cluster": random.choice(clusters),
        "level": random.choice(levels),
        "message": random.choice(messages),
        "namespace": "default",
    }
    lines.append(json.dumps({"index": {"_index": "demo-logs-000001"}}))
    lines.append(json.dumps(doc))

for i in range(300):
    ts = now - timedelta(seconds=i * 10)
    cl = random.choice(clusters)
    ns = random.choice(namespaces)
    doc = {
        "@timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "logmgmt": {"kind": "openshift", "category": "log"},
        "k8s": {"cluster": {"name": cl}, "namespace": {"name": ns}},
        "orchestrator": {"namespace": ns, "resource": {"name": random.choice(workload_pod_names[cl])}},
        "log": {"level": random.choice(log_levels)},
        "message": random.choice(messages),
    }
    lines.append(json.dumps({"index": {"_index": "demo-logs-000001"}}))
    lines.append(json.dumps(doc))

for i in range(150):
    ts = now - timedelta(seconds=i * 20)
    cl = random.choice(clusters)
    ns = random.choice(namespaces)
    doc = {
        "@timestamp": ts.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "logmgmt": {"kind": "openshift", "category": "event"},
        "k8s": {"cluster": {"name": cl}, "namespace": {"name": ns}},
        "orchestrator": {"namespace": ns, "resource": {"name": random.choice(workload_pod_names[cl])}},
        "event": {"type": random.choice(event_types), "reason": random.choice(event_reasons)},
        "message": random.choice(event_reasons),
    }
    lines.append(json.dumps({"index": {"_index": "demo-logs-000001"}}))
    lines.append(json.dumps(doc))

bulk_body = ("\n".join(lines) + "\n").encode("utf-8")

req = urllib.request.Request(
    f"{ES_URL}/demo-logs-000001/_bulk",
    data=bulk_body,
    method="POST",
    headers={"Content-Type": "application/x-ndjson"},
)
with urllib.request.urlopen(req, timeout=30) as resp:
    print(f"Bulk index response: {resp.status}")

print("Elasticsearch demo data seeded.")
