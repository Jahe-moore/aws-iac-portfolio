"""Site API and uptime checker, one function.

- GET /api/visit   adds one to the visitor counter and returns the totals
- GET /api/health  returns the uptime checker's recent history
- EventBridge schedule (source "aws.events") runs the uptime check
"""

import datetime
import json
import os
import time
import urllib.request
from decimal import Decimal

import boto3

TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
CLOUDWATCH = boto3.client("cloudwatch")
SITE_URL = os.environ["SITE_URL"]
METRIC_NAMESPACE = os.environ["METRIC_NAMESPACE"]
HISTORY_LENGTH = 48
HEADERS = {"content-type": "application/json", "cache-control": "no-store"}


def handler(event, context):
    if event.get("source") == "aws.events":
        return check_site()

    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "")
    if method != "GET":
        return respond(405, {"error": "method not allowed"})
    if path == "/api/visit":
        return respond(200, record_visit())
    if path == "/api/health":
        return respond(200, read_health())
    return respond(404, {"error": "not found"})


def respond(status, body):
    return {"statusCode": status, "headers": HEADERS, "body": json.dumps(body, default=plain)}


def plain(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(type(value))


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def record_visit():
    today = now().strftime("%Y-%m-%d")
    total = TABLE.update_item(
        Key={"id": "visits"},
        UpdateExpression="ADD hits :one",
        ExpressionAttributeValues={":one": 1},
        ReturnValues="UPDATED_NEW",
    )["Attributes"]["hits"]
    expires = int(time.time()) + 3 * 86400
    day = TABLE.update_item(
        Key={"id": f"visits#{today}"},
        UpdateExpression="ADD hits :one SET expires_at = :exp",
        ExpressionAttributeValues={":one": 1, ":exp": expires},
        ReturnValues="UPDATED_NEW",
    )["Attributes"]["hits"]
    return {"total": total, "today": day}


def read_health():
    item = TABLE.get_item(Key={"id": "health"}).get("Item")
    if not item:
        return {"checked_at": None, "up": None, "history": []}
    history = item.get("history", [])
    up_count = sum(1 for h in history if h["up"])
    last = history[-1] if history else {}
    return {
        "checked_at": last.get("t"),
        "up": last.get("up"),
        "status": last.get("status"),
        "latency_ms": last.get("ms"),
        "uptime_pct": round(100 * up_count / len(history), 1) if history else None,
        "history": [{"t": h["t"], "up": h["up"], "ms": h["ms"]} for h in history],
    }


def check_site():
    started = time.monotonic()
    status = 0
    try:
        request = urllib.request.Request(SITE_URL, headers={"user-agent": "iac-portfolio-uptime-check"})
        with urllib.request.urlopen(request, timeout=10) as response:
            status = response.status
    except Exception:
        status = 0
    latency = int((time.monotonic() - started) * 1000)
    up = status == 200

    entry = {"t": now().strftime("%Y-%m-%dT%H:%M:%SZ"), "up": up, "status": status, "ms": latency}
    item = TABLE.get_item(Key={"id": "health"}).get("Item") or {"history": []}
    history = (item.get("history", []) + [entry])[-HISTORY_LENGTH:]
    TABLE.put_item(Item={"id": "health", "history": history})

    CLOUDWATCH.put_metric_data(
        Namespace=METRIC_NAMESPACE,
        MetricData=[{"MetricName": "SiteUp", "Value": 1 if up else 0, "Unit": "Count"}],
    )
    return entry
