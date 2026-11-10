"""Site API and uptime checker, one function.

- GET /api/visit   adds one to the visitor and country counters, returns totals
                   and what CloudFront and Lambda saw for this request
- GET /api/health  returns the uptime checker's recent history
- GET /api/perf    returns the last 24 hours of this function's CloudWatch metrics
- EventBridge schedule (source "aws.events") runs the uptime check and refreshes
  the performance snapshot
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
FUNCTION_NAME = os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "")
HEADERS = {"content-type": "application/json", "cache-control": "no-store"}
COLD_START = True


def handler(event, context):
    global COLD_START
    cold, COLD_START = COLD_START, False
    started = time.monotonic()

    if event.get("source") == "aws.events":
        entry = check_site()
        refresh_perf()
        return entry

    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "")
    if method != "GET":
        return respond(405, {"error": "method not allowed"})
    if path == "/api/visit":
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        body = record_visit(headers.get("cloudfront-viewer-country", ""))
        body["request"] = {
            "country": headers.get("cloudfront-viewer-country"),
            "tls": (headers.get("cloudfront-viewer-tls") or "").split(":")[0] or None,
            "http": headers.get("cloudfront-viewer-http-version"),
            "cold_start": cold,
            "duration_ms": round((time.monotonic() - started) * 1000, 1),
            "request_id": context.aws_request_id,
        }
        return respond(200, body)
    if path == "/api/health":
        return respond(200, read_health())
    if path == "/api/perf":
        item = TABLE.get_item(Key={"id": "perf"}).get("Item")
        return respond(200, item.get("data") if item else {"updated_at": None, "hourly": []})
    return respond(404, {"error": "not found"})


def respond(status, body):
    return {"statusCode": status, "headers": HEADERS, "body": json.dumps(body, default=plain)}


def plain(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(type(value))


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def record_visit(country):
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
    countries = {}
    code = country.upper() if len(country) == 2 and country.isalpha() else ""
    if code:
        countries = TABLE.update_item(
            Key={"id": "countries"},
            UpdateExpression="ADD #c :one",
            ExpressionAttributeNames={"#c": code},
            ExpressionAttributeValues={":one": 1},
            ReturnValues="ALL_NEW",
        )["Attributes"]
    else:
        countries = TABLE.get_item(Key={"id": "countries"}).get("Item") or {}
    ranked = sorted(
        ({"code": k, "hits": v} for k, v in countries.items() if k != "id"),
        key=lambda c: c["hits"],
        reverse=True,
    )[:10]
    return {"total": total, "today": day, "countries": ranked}


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


def refresh_perf():
    """Save the last 24 hours of this function's metrics, hour by hour."""
    end = now().replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=1)
    start = end - datetime.timedelta(hours=24)
    dims = [{"Name": "FunctionName", "Value": FUNCTION_NAME}]

    def query(qid, metric, stat):
        return {
            "Id": qid,
            "MetricStat": {
                "Metric": {"Namespace": "AWS/Lambda", "MetricName": metric, "Dimensions": dims},
                "Period": 3600,
                "Stat": stat,
            },
        }

    result = CLOUDWATCH.get_metric_data(
        MetricDataQueries=[
            query("req", "Invocations", "Sum"),
            query("err", "Errors", "Sum"),
            query("p50", "Duration", "p50"),
            query("mx", "Duration", "Maximum"),
        ],
        StartTime=start,
        EndTime=end,
    )
    series = {
        r["Id"]: {t.strftime("%Y-%m-%dT%H:00:00Z"): v for t, v in zip(r["Timestamps"], r["Values"])}
        for r in result["MetricDataResults"]
    }
    hours = [(start + datetime.timedelta(hours=i)).strftime("%Y-%m-%dT%H:00:00Z") for i in range(24)]
    hourly = [
        {
            "t": h,
            "requests": int(series["req"].get(h, 0)),
            "errors": int(series["err"].get(h, 0)),
            "p50_ms": round(series["p50"][h], 1) if h in series["p50"] else None,
        }
        for h in hours
    ]
    p50s = [series["p50"][h] for h in hours if h in series["p50"]]
    data = {
        "updated_at": now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_hours": 24,
        "requests": sum(h["requests"] for h in hourly),
        "errors": sum(h["errors"] for h in hourly),
        "p50_ms": round(sorted(p50s)[len(p50s) // 2], 1) if p50s else None,
        "max_ms": round(max(series["mx"].values()), 1) if series["mx"] else None,
        "hourly": hourly,
    }
    TABLE.put_item(Item={"id": "perf", "data": json.loads(json.dumps(data), parse_float=Decimal)})
