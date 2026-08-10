import json
import os
import random
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ES_URL = os.environ.get("ES_URL", "http://elasticsearch:9200")

clusters = ["demo-cluster-aws", "demo-cluster-gce"]
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

print(f"Waiting for Elasticsearch at {ES_URL}...")
while True:
    try:
        with urllib.request.urlopen(ES_URL, timeout=5) as resp:
            if resp.status == 200:
                break
    except (urllib.error.URLError, ConnectionError):
        pass
    time.sleep(2)

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
