import json
import os
import time
import urllib.error
import urllib.request

RQLITE_URL = os.environ.get("RQLITE_URL", "http://rqlite:4001")


def execute(statements):
    req = urllib.request.Request(
        f"{RQLITE_URL}/db/execute",
        data=json.dumps(statements).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


print(f"Waiting for rqlite at {RQLITE_URL}...")
while True:
    try:
        with urllib.request.urlopen(f"{RQLITE_URL}/status", timeout=5) as resp:
            if resp.status == 200:
                break
    except (urllib.error.URLError, ConnectionError):
        pass
    time.sleep(2)

print("Seeding rqlite with demo cluster ownership data...")

execute(
    [
        "DROP TABLE IF EXISTS clusters",
        """CREATE TABLE clusters (
            name TEXT PRIMARY KEY,
            environment TEXT,
            owner_team TEXT,
            cost_center TEXT,
            created_at TEXT
        )""",
    ]
)

execute(
    [
        [
            "INSERT INTO clusters (name, environment, owner_team, cost_center, created_at) VALUES (?, ?, ?, ?, ?)",
            "demo-cluster-aws",
            "production",
            "platform-team",
            "CC-1001",
            "2025-01-15",
        ],
        [
            "INSERT INTO clusters (name, environment, owner_team, cost_center, created_at) VALUES (?, ?, ?, ?, ?)",
            "demo-cluster-gce",
            "staging",
            "data-team",
            "CC-1002",
            "2025-03-02",
        ],
    ]
)

print("rqlite demo data seeded.")
