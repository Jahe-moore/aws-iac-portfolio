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

  window.addEventListener("hashchange", function () { select(location.hash.slice(1), false, false); });
  select(location.hash.slice(1), false, false);

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
      fill($("s-resources"), [res]);
      fill($("l-resources"), [res + " resources managed by Terraform"]);
    }
    var cert = date(d.cert_expires);
    if (cert) {
      fill($("l-cert"), ["Valid until " + localDate(cert), el("span", "sub", " · renews automatically before expiry")]);
    }

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
  getJSON("/api/visit").then(function (d) {
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
})();
