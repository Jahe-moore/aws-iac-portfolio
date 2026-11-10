(function () {
  "use strict";

  var NA = "Not available yet";
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var ids = tabs.map(function (t) { return t.getAttribute("aria-controls"); });

  function select(id, focus, push) {
    if (ids.indexOf(id) === -1) id = ids[0];
    tabs.forEach(function (t) {
      var on = t.getAttribute("aria-controls") === id;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
      if (on && focus) t.focus();
      if (on && push && t.scrollIntoView) t.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    if (push && location.hash !== "#" + id) {
      history.replaceState(null, "", "#" + id);
    }
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(t.getAttribute("aria-controls"), false, true); });
    t.addEventListener("keydown", function (e) {
      var n = null;
      if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = tabs.length - 1;
      if (n === null) return;
      e.preventDefault();
      select(tabs[n].getAttribute("aria-controls"), true, true);
    });
  });

  /* A hash can name a tab (#live) or an element inside one (#inventory). */
  function route(scroll) {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { id = ""; }
    if (!id || ids.indexOf(id) !== -1) { select(id, false, false); return; }
    var target = document.getElementById(id);
    var panel = target && target.closest ? target.closest('[role="tabpanel"]') : null;
    select(panel ? panel.id : ids[0], false, false);
    if (panel && scroll && target.scrollIntoView) target.scrollIntoView({ block: "start" });
  }
  window.addEventListener("hashchange", function () { route(true); });
  route(false);

  /* ---------- helpers ---------- */
  function getJSON(url) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(url, { cache: "no-store", credentials: "same-origin", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (d) {
        if (!d || typeof d !== "object") throw new Error("bad body");
        return d;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function getWithHeaders(url) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(url, { cache: "no-store", credentials: "same-origin", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json().then(function (d) {
          if (!d || typeof d !== "object") throw new Error("bad body");
          return { data: d, headers: r.headers };
        });
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { regionNames = null; }
  function countryName(code) {
    if (typeof code !== "string" || !/^[A-Za-z]{2}$/.test(code)) return null;
    code = code.toUpperCase();
    if (code === "XX" || code === "ZZ") return "Unknown";
    var n = null;
    try { n = regionNames ? regionNames.of(code) : null; } catch (e) { n = null; }
    return n && n !== code ? n : code;
  }

  function date(v) {
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function rel(d) {
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    var future = s < 0; s = Math.abs(s);
    var out;
    if (s < 45 || (future && s < 3600)) out = "just now";
    else if (s < 3600) out = Math.round(s / 60) + " min";
    else if (s < 86400) { var h = Math.round(s / 3600); out = h + (h === 1 ? " hour" : " hours"); }
    else { var dd = Math.round(s / 86400); out = dd + (dd === 1 ? " day" : " days"); }
    if (out === "just now") return out;
    return future ? "in " + out : out + " ago";
  }

  function local(d) {
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  }

  function localDate(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function num(n) {
    return typeof n === "number" && isFinite(n) ? n.toLocaleString() : null;
  }

  function safeUrl(u) {
    if (typeof u !== "string") return null;
    try {
      var p = new URL(u, location.href);
      return p.protocol === "https:" ? p.href : null;
    } catch (e) { return null; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function link(href, text) {
    var u = safeUrl(href);
    if (!u) return el("span", null, text);
    var a = el("a", null, text);
    a.href = u; a.rel = "noopener";
    return a;
  }

  function fill(node, parts) {
    if (!node) return;
    node.textContent = "";
    node.removeAttribute("data-empty");
    node.classList.remove("muted");
    parts.forEach(function (p) {
      node.appendChild(typeof p === "string" ? document.createTextNode(p) : p);
    });
  }

  function timeEl(d, text) {
    var t = el("time", null, text);
    t.dateTime = d.toISOString();
    t.title = local(d);
    return t;
  }

  function short(sha) { return typeof sha === "string" ? sha.slice(0, 7) : null; }

  /* ---------- deploy.json ---------- */
  getJSON("/status/deploy.json").then(function (d) {
    var when = date(d.deployed_at);
    var sha = short(d.commit);
    var msg = typeof d.message === "string" ? d.message : "";
    var res = num(d.resources);

    if (when) {
      fill($("s-deploy"), [timeEl(when, rel(when))]);
      fill($("l-time"), [timeEl(when, local(when)), el("span", "sub", " · " + rel(when))]);
    }
    if (sha) {
      var parts = [link(d.commit_url, sha)];
      if (msg) parts.push(el("span", "sub", " " + msg));
      fill($("s-commit"), parts);
      $("s-commit").title = msg;
      fill($("l-commit"), [link(d.commit_url, sha)]);
    }
    if (msg) fill($("l-message"), [msg]);
    if (safeUrl(d.run_url)) {
      var runId = (String(d.run_url).match(/runs\/(\d+)/) || [])[1];
      fill($("s-run"), [link(d.run_url, "GitHub Actions")]);
      fill($("l-run"), [link(d.run_url, runId ? "GitHub Actions run " + runId : "GitHub Actions run")]);
    }
    if (res) {
      var invLink = el("a", null, res);
      invLink.href = "#inventory";
      fill($("s-resources"), [invLink]);
      fill($("l-resources"), [res + " resources managed by Terraform"]);
    }
    var cert = date(d.cert_expires);
    if (cert) {
      fill($("l-cert"), ["Valid until " + localDate(cert), el("span", "sub", " · renews automatically before expiry")]);
    }

    try { renderInventory(d.inventory); } catch (e) { /* quiet */ }

    var scan = d.scan;
    if (scan && typeof scan === "object") {
      var p = num(scan.passed), f = num(scan.failed), s = num(scan.skipped);
      var tool = typeof scan.tool === "string" ? scan.tool : "Checkov";
      if (p !== null) $("sec-passed").textContent = p;
      if (f !== null) {
        $("sec-failed").textContent = f;
        $("sec-failed").classList.add(scan.failed > 0 ? "bad" : "ok");
      }
      if (s !== null) $("sec-skipped").textContent = s;
      if (p !== null && f !== null) {
        fill($("sec-scan-inline"), ["Latest: " + p + " passed, " + f + " failed" + (s !== null ? ", " + s + " skipped as accepted risks." : ".")]);
      }
      if (when) $("sec-tool").textContent = tool + " results from the build deployed " + rel(when) + ".";

      var list = $("sec-skips");
      if (Array.isArray(scan.skips)) {
        list.textContent = "";
        if (!scan.skips.length) list.appendChild(el("li", "muted", "No checks skipped."));
        scan.skips.forEach(function (k) {
          if (!k || typeof k !== "object") return;
          var li = el("li");
          li.appendChild(el("span", "risk-id", String(k.id || "")));
          li.appendChild(document.createTextNode(String(k.reason || "")));
          list.appendChild(li);
        });
      }
    }
  }).catch(function () { /* quiet: placeholders stay */ });

  /* ---------- inventory ---------- */
  var SERVICES = [
    ["aws_s3_", "S3", "s3"],
    ["aws_cloudfront_", "CloudFront", "cloudfront"],
    ["aws_acm_", "ACM", "acm"],
    ["aws_lambda_", "Lambda", "lambda"],
    ["aws_dynamodb_", "DynamoDB", "dynamodb"],
    ["aws_cloudwatch_event_", "EventBridge", "cloudwatch_event"],
    ["aws_cloudwatch_", "CloudWatch", "cloudwatch"],
    ["aws_sns_", "SNS", "sns"],
    ["aws_iam_", "IAM", "iam"]
  ];
  var ORDER = ["S3", "CloudFront", "ACM", "Lambda", "DynamoDB", "EventBridge", "CloudWatch", "SNS", "IAM", "Other"];

  function serviceOf(type) {
    for (var i = 0; i < SERVICES.length; i++) {
      if (type.indexOf(SERVICES[i][0]) === 0) return SERVICES[i];
    }
    return null;
  }

  function readable(type, address) {
    var svc = serviceOf(type);
    var kind = type.replace(/^aws_/, "");
    if (svc) kind = kind.slice(svc[2].length).replace(/^_/, "");
    kind = kind.replace(/_/g, " ").replace(/\b(url|iam|oidc|tls|sns|sqs|kms|arn|api)\b/g, function (w) { return w.toUpperCase(); });
    if (!svc) kind = kind.replace(/^budgets budget/, "budget");
    var label = (svc ? svc[1] : "AWS") + (kind ? " " + kind : "");
    var name = address;
    var at = address.lastIndexOf(type + ".");
    if (at !== -1) name = address.slice(at + type.length + 1);
    return { label: label, name: name };
  }

  function renderInventory(inv) {
    if (!Array.isArray(inv) || !inv.length) return;
    var groups = {};
    inv.forEach(function (r) {
      if (!r || typeof r.type !== "string" || typeof r.address !== "string") return;
      if (r.address.indexOf("data.") === 0) return;
      var svc = serviceOf(r.type);
      var key = svc ? svc[1] : "Other";
      (groups[key] = groups[key] || []).push(readable(r.type, r.address));
    });
    var grid = $("inv-grid");
    var total = 0;
    var frag = document.createDocumentFragment();
    ORDER.forEach(function (key) {
      var items = groups[key];
      if (!items || !items.length) return;
      total += items.length;
      items.sort(function (a, b) { return (a.label + a.name).localeCompare(b.label + b.name); });
      var card = el("div", "inv-card");
      var head = el("div", "inv-head");
      head.appendChild(el("h4", null, key));
      head.appendChild(el("span", "inv-n", String(items.length)));
      card.appendChild(head);
      var ul = el("ul");
      items.forEach(function (it) {
        var li = el("li");
        li.appendChild(el("b", null, it.label + ": "));
        li.appendChild(document.createTextNode(it.name));
        ul.appendChild(li);
      });
      card.appendChild(ul);
      frag.appendChild(card);
    });
    if (!total) return;
    grid.textContent = "";
    grid.appendChild(frag);
    $("inv-note").textContent = total + " resources Terraform manages in the live deployment, grouped by AWS service.";
  }

  /* ---------- drift.json ---------- */
  getJSON("/status/drift.json").then(function (d) {
    if (typeof d.drift !== "boolean") return;
    var when = date(d.checked_at);
    var parts = [el("span", "badge " + (d.drift ? "bad" : "ok"), d.drift ? "Drift found" : "No drift")];
    parts.push("Last nightly check" + (when ? " " + rel(when) : ""));
    if (safeUrl(d.run_url)) { parts.push(" · "); parts.push(link(d.run_url, "run")); }
    var node = $("op-drift");
    fill(node, parts);
    if (when) node.title = local(when);
  }).catch(function () {});

  /* ---------- visit counter: once per page load ---------- */
  var EDGES = {
    LAX: "Los Angeles", SFO: "San Francisco", SJC: "San Jose", SEA: "Seattle", PDX: "Portland", HIO: "Hillsboro, Oregon",
    PHX: "Phoenix", DEN: "Denver", DFW: "Dallas", IAH: "Houston", HOU: "Houston", ORD: "Chicago", MSP: "Minneapolis",
    DTW: "Detroit", ATL: "Atlanta", MIA: "Miami", TPA: "Tampa", JAX: "Jacksonville", IAD: "Ashburn, Virginia",
    JFK: "New York", EWR: "Newark", BOS: "Boston", PHL: "Philadelphia", PIT: "Pittsburgh", CMH: "Columbus",
    MCI: "Kansas City", SLC: "Salt Lake City", BNA: "Nashville", CLT: "Charlotte", ANC: "Anchorage", HNL: "Honolulu",
    YVR: "Vancouver", YYZ: "Toronto", YTO: "Toronto", YUL: "Montreal", MEX: "Mexico City", QRO: "Queretaro",
    GRU: "Sao Paulo", GIG: "Rio de Janeiro", EZE: "Buenos Aires", SCL: "Santiago", BOG: "Bogota", LIM: "Lima",
    LHR: "London", MAN: "Manchester", DUB: "Dublin", CDG: "Paris", MRS: "Marseille", FRA: "Frankfurt", MUC: "Munich",
    DUS: "Dusseldorf", HAM: "Hamburg", AMS: "Amsterdam", BRU: "Brussels", MAD: "Madrid", BCN: "Barcelona",
    LIS: "Lisbon", MXP: "Milan", FCO: "Rome", ZRH: "Zurich", VIE: "Vienna", PRG: "Prague", WAW: "Warsaw",
    ARN: "Stockholm", CPH: "Copenhagen", OSL: "Oslo", HEL: "Helsinki", ATH: "Athens", SOF: "Sofia", BUD: "Budapest",
    TLV: "Tel Aviv", DXB: "Dubai", FJR: "Fujairah", BAH: "Bahrain", JNB: "Johannesburg", CPT: "Cape Town",
    NBO: "Nairobi", LOS: "Lagos", BOM: "Mumbai", DEL: "New Delhi", BLR: "Bangalore", MAA: "Chennai", HYD: "Hyderabad",
    CCU: "Kolkata", SIN: "Singapore", KUL: "Kuala Lumpur", BKK: "Bangkok", CGK: "Jakarta", MNL: "Manila",
    HKG: "Hong Kong", TPE: "Taipei", NRT: "Tokyo", HND: "Tokyo", KIX: "Osaka", ICN: "Seoul", SYD: "Sydney",
    MEL: "Melbourne", BNE: "Brisbane", PER: "Perth", AKL: "Auckland"
  };

  function setDD(id, main, sub, title) {
    var node = $(id);
    if (!node) return;
    var parts = [main];
    if (sub) parts.push(el("span", "sub", sub));
    fill(node, parts);
    if (title) node.title = title;
  }

  function renderTrace(d, headers) {
    var pop = headers ? headers.get("x-amz-cf-pop") : null;
    if (pop && /^[A-Za-z]{3}/.test(pop)) {
      var code = pop.slice(0, 3).toUpperCase();
      setDD("t-edge", EDGES[code] || code, "CloudFront " + pop, null);
    }
    var xc = headers ? headers.get("x-cache") : null;
    if (xc) {
      var hit = /^hit/i.test(xc), miss = /^miss/i.test(xc);
      setDD("t-cache", hit ? "Hit" : miss ? "Miss" : xc.split(" ")[0],
        hit ? "served from the edge cache" : miss ? "passed through to Lambda" : xc, xc);
    }
    var rq = d.request && typeof d.request === "object" ? d.request : null;
    if (!rq) return;
    var cn = countryName(rq.country);
    if (cn) setDD("t-country", cn, cn !== "Unknown" ? String(rq.country).toUpperCase() : null, null);
    if (typeof rq.tls === "string" && rq.tls) setDD("t-tls", rq.tls.replace(/^TLSv/i, "TLS "), "encrypted in transit", null);
    if (typeof rq.http === "string" && rq.http) {
      var hv = rq.http.replace(/^HTTP\//i, "");
      setDD("t-http", "HTTP/" + (hv === "2.0" ? "2" : hv === "3.0" ? "3" : hv), null, null);
    }
    var dur = num(rq.duration_ms);
    if (dur !== null) setDD("t-dur", dur + " ms", "time inside the function", null);
    if (typeof rq.cold_start === "boolean") {
      setDD("t-start", rq.cold_start ? "Cold" : "Warm", rq.cold_start ? "fresh environment loaded" : "reused a running environment", null);
    }
    if (typeof rq.request_id === "string" && rq.request_id) {
      var rid = rq.request_id;
      setDD("t-rid", rid.length > 13 ? rid.slice(0, 8) + "..." : rid, "AWS request ID", rid);
    }
  }

  function renderCountries(list) {
    var ol = $("l-countries");
    if (!Array.isArray(list)) return;
    var rows = list.filter(function (c) {
      return c && typeof c.hits === "number" && isFinite(c.hits) && c.hits > 0 && countryName(c.code);
    }).sort(function (a, b) { return b.hits - a.hits; });
    if (!rows.length) return;
    var sum = rows.reduce(function (a, c) { return a + c.hits; }, 0);
    var top = rows[0].hits;
    ol.textContent = "";
    rows.slice(0, 10).forEach(function (c) {
      var name = countryName(c.code);
      var share = Math.round(c.hits / sum * 1000) / 10;
      var li = el("li");
      li.appendChild(el("span", "hb-name", name));
      var track = el("span", "hb-track");
      track.setAttribute("aria-hidden", "true");
      var f = el("span", "hb-fill");
      f.style.width = Math.max(2, Math.round(c.hits / top * 100)) + "%";
      track.appendChild(f);
      li.appendChild(track);
      var v = el("span", "hb-val");
      v.appendChild(el("b", null, c.hits.toLocaleString()));
      v.appendChild(document.createTextNode(" · " + share + "%"));
      li.appendChild(v);
      ol.appendChild(li);
    });
  }

  getWithHeaders("/api/visit").then(function (res) {
    var d = res.data;
    try { renderTrace(d, res.headers); } catch (e) { /* quiet */ }
    try { renderCountries(d.countries); } catch (e) { /* quiet */ }
    var t = num(d.total), td = num(d.today);
    if (t !== null) {
      fill($("s-visitors"), [t]);
      $("l-total").textContent = t;
    }
    if (td !== null) $("l-today").textContent = td;
  }).catch(function () {
    $("l-visit-note").textContent = "Visitor count not available yet. When live, a Python Lambda function increments it in DynamoDB with an atomic update.";
  });

  /* ---------- health ---------- */
  getJSON("/api/health").then(function (d) {
    var checked = date(d.checked_at);
    var ms = num(d.latency_ms);
    if (typeof d.up === "boolean") {
      var dot = el("span", "dot " + (d.up ? "up" : "down"));
      fill($("s-status"), [dot, d.up ? "Up" : "Down", ms !== null ? el("span", "sub", " · " + ms + " ms") : ""]);
      $("op-status").textContent = d.up ? "Up" : "Down";
      $("op-status").classList.add(d.up ? "ok" : "bad");
    }
    if (ms !== null) $("op-latency").textContent = ms + " ms";
    if (typeof d.uptime_pct === "number" && isFinite(d.uptime_pct)) {
      $("op-uptime").textContent = (Math.round(d.uptime_pct * 10) / 10) + "%";
    }
    if (checked) {
      var c = $("op-checked");
      c.textContent = "";
      c.appendChild(timeEl(checked, rel(checked)));
    }

    var hist = Array.isArray(d.history) ? d.history.filter(function (h) { return h && typeof h === "object"; }).slice(-48) : [];
    if (!hist.length) return;
    var spark = $("op-spark");
    spark.textContent = "";
    var maxMs = 1;
    hist.forEach(function (h) { if (typeof h.ms === "number" && h.ms > maxMs) maxMs = h.ms; });
    for (var i = hist.length; i < 48; i++) spark.appendChild(el("span", "bar empty"));
    var up = 0, msList = [];
    hist.forEach(function (h) {
      var isUp = h.up === true;
      if (isUp) up++;
      var bar = el("span", "bar" + (isUp ? "" : " down"));
      var pct = isUp && typeof h.ms === "number" ? Math.max(12, Math.round(h.ms / maxMs * 100)) : 100;
      bar.style.height = pct + "%";
      var t = date(h.t);
      bar.title = (t ? local(t) + ": " : "") + (isUp ? "up" : "down") + (typeof h.ms === "number" ? ", " + h.ms + " ms" : "");
      if (isUp && typeof h.ms === "number") msList.push(h.ms);
      spark.appendChild(bar);
    });
    var first = date(hist[0].t);
    if (first) $("op-axis-start").textContent = rel(first);
    msList.sort(function (a, b) { return a - b; });
    var median = msList.length ? msList[Math.floor(msList.length / 2)] : null;
    var down = hist.length - up;
    $("op-summary").textContent = "Last " + hist.length + " checks: " + up + " up, " + down + " down" +
      (median !== null ? "; median response " + median + " ms." : ".");
  }).catch(function () {});

  /* ---------- live header check ---------- */
  var HDRS = [
    ["content-security-policy", "Content-Security-Policy"],
    ["strict-transport-security", "Strict-Transport-Security"],
    ["x-frame-options", "X-Frame-Options"],
    ["x-content-type-options", "X-Content-Type-Options"],
    ["referrer-policy", "Referrer-Policy"],
    ["permissions-policy", "Permissions-Policy"]
  ];
  (function () {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    fetch("/", { method: "HEAD", cache: "no-store", credentials: "same-origin", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) return;
        var body = $("hdr-rows");
        body.textContent = "";
        HDRS.forEach(function (h) {
          var v = r.headers.get(h[0]);
          var tr = el("tr");
          tr.appendChild(el("td", null, h[1]));
          var st = el("td");
          st.appendChild(el("span", "badge " + (v ? "ok" : "bad"), v ? "Present" : "Missing"));
          tr.appendChild(st);
          tr.appendChild(el("td", "hv" + (v ? "" : " muted"), v || "Not sent"));
          body.appendChild(tr);
        });
      })
      .catch(function () {})
      .finally(function () { if (timer) clearTimeout(timer); });
  })();

  /* ---------- API performance ---------- */
  getJSON("/api/perf").then(function (d) {
    var req = num(d.requests), p50 = num(d.p50_ms), mx = num(d.max_ms), er = num(d.errors);
    if (req !== null) $("pf-req").textContent = req;
    if (p50 !== null) $("pf-p50").textContent = p50 + " ms";
    if (mx !== null) $("pf-max").textContent = mx + " ms";
    if (er !== null) {
      $("pf-err").textContent = er;
      $("pf-err").classList.add(d.errors > 0 ? "bad" : "ok");
    }
    var hours = Array.isArray(d.hourly) ? d.hourly.filter(function (h) {
      return h && typeof h.requests === "number" && isFinite(h.requests) && h.requests >= 0;
    }).slice(-24) : [];
    if (!hours.length) return;
    var bars = $("pf-bars");
    bars.textContent = "";
    var top = 1;
    hours.forEach(function (h) { if (h.requests > top) top = h.requests; });
    for (var i = hours.length; i < 24; i++) bars.appendChild(el("span", "bar empty"));
    var busiest = hours[0], errHours = 0;
    var hm = function (t) { return t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
    hours.forEach(function (h) {
      var hasErr = typeof h.errors === "number" && h.errors > 0;
      if (hasErr) errHours++;
      if (h.requests > busiest.requests) busiest = h;
      var b = el("span", "bar" + (hasErr ? " err" : ""));
      b.style.height = (h.requests > 0 ? Math.max(6, Math.round(h.requests / top * 100)) : 2) + "%";
      var t = date(h.t);
      b.title = (t ? hm(t) + ": " : "") + h.requests + " requests" +
        (typeof h.p50_ms === "number" ? ", median " + h.p50_ms + " ms" : "") +
        (hasErr ? ", " + h.errors + " errors" : "");
      bars.appendChild(b);
    });
    var bt = date(busiest.t);
    var sum = hours.reduce(function (a, h) { return a + h.requests; }, 0);
    var upd = date(d.updated_at);
    $("pf-summary").textContent = sum.toLocaleString() + " requests across " + hours.length + " hours" +
      (busiest.requests > 0 ? "; busiest hour " + (bt ? "starting " + hm(bt) + " " : "") + "with " + busiest.requests : "") +
      "; " + (errHours ? errHours + (errHours === 1 ? " hour" : " hours") + " with errors" : "no hours with errors") +
      (upd ? ". Updated " + rel(upd) + "." : ".");
  }).catch(function () {});
})();
