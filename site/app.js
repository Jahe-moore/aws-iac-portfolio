(function () {
  "use strict";

  var REPO = "https://github.com/Jahe-moore/aws-iac-portfolio/blob/main/";
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var ids = tabs.map(function (t) { return t.getAttribute("aria-controls"); });

  function select(id, focus) {
    if (ids.indexOf(id) === -1) id = ids[0];
    tabs.forEach(function (t) {
      var on = t.getAttribute("aria-controls") === id;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
      if (on && focus) t.focus();
    });
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  }

  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(t.getAttribute("aria-controls"), false); });
    t.addEventListener("keydown", function (e) {
      var n = null;
      if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
      if (n === null) return;
      e.preventDefault();
      select(tabs[n].getAttribute("aria-controls"), true);
    });
  });
  select(location.hash.slice(1), false);

  /* ---------- source files ---------- */
  var cache = {};
  function getFile(path) {
    if (!cache[path]) {
      cache[path] = fetch("source/" + path, { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      });
    }
    return cache[path];
  }

  /* HCL block: from the marker line until the braces close. */
  function hclBlock(lines, start) {
    var depth = 0, opened = false, out = [];
    for (var i = start; i < lines.length; i++) {
      out.push(lines[i]);
      var code = lines[i].replace(/#.*$/, "");
      for (var c = 0; c < code.length; c++) {
        if (code[c] === "{") { depth++; opened = true; }
        else if (code[c] === "}") depth--;
      }
      if (opened && depth <= 0) break;
    }
    return out;
  }

  /* YAML block: the marker line plus every deeper-indented line after it. */
  function yamlBlock(lines, start) {
    var indent = lines[start].search(/\S/), out = [lines[start]];
    for (var i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === "") { out.push(lines[i]); continue; }
      if (lines[i].search(/\S/) <= indent) break;
      out.push(lines[i]);
    }
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    return out;
  }

  function excerpt(text, ex) {
    var lines = text.replace(/\r/g, "").split("\n");
    var start = -1;
    for (var i = 0; i < lines.length; i++) { if (lines[i].indexOf(ex.marker) !== -1) { start = i; break; } }
    if (start === -1) return null;
    var block = ex.kind === "yaml" ? yamlBlock(lines, start) : hclBlock(lines, start);
    if (ex.max && block.length > ex.max) block = block.slice(0, ex.max).concat(["          ..."]);
    var pad = Math.min.apply(null, block.filter(function (l) { return l.trim(); }).map(function (l) { return l.search(/\S/); }));
    return { code: block.map(function (l) { return l.slice(pad); }).join("\n"), line: start + 1 };
  }

  /* Minimal highlighter: comments, strings, block keywords. Built with text nodes only. */
  var KEYWORDS = /^(resource|data|variable|output|provider|terraform|locals|backend|statement|condition|principals|module|name|uses|run|with|if|on|jobs|steps|permissions|env)\b/;
  function highlight(pre, code) {
    pre.textContent = "";
    code.split("\n").forEach(function (line, n) {
      if (n) pre.appendChild(document.createTextNode("\n"));
      var i = 0, buf = "";
      function flush() { if (buf) { pre.appendChild(document.createTextNode(buf)); buf = ""; } }
      function span(cls, text) { flush(); var s = document.createElement("span"); s.className = cls; s.textContent = text; pre.appendChild(s); }
      var lead = line.match(/^\s*(- )?/)[0];
      buf += lead; i = lead.length;
      var kw = line.slice(i).match(KEYWORDS);
      if (kw) { span("tk-k", kw[0]); i += kw[0].length; }
      while (i < line.length) {
        var ch = line[i];
        if (ch === "#" || (ch === "/" && line[i + 1] === "/")) { span("tk-c", line.slice(i)); i = line.length; break; }
        if (ch === '"' || ch === "'") {
          var j = i + 1;
          while (j < line.length && line[j] !== ch) { if (line[j] === "\\") j++; j++; }
          span("tk-s", line.slice(i, j + 1)); i = j + 1; continue;
        }
        buf += ch; i++;
      }
      flush();
    });
  }

  function renderExcerpts(containerId, list) {
    var box = $(containerId);
    list.forEach(function (ex) {
      var card = document.createElement("article");
      card.className = "ex";
      var text = document.createElement("div");
      text.className = "ex-text";
      var h = document.createElement("h3"); h.textContent = ex.title;
      var p = document.createElement("p"); p.textContent = ex.why;
      var a = document.createElement("a");
      a.textContent = ex.file; a.href = REPO + ex.file; a.rel = "noopener"; a.className = "ex-file";
      text.appendChild(h); text.appendChild(p); text.appendChild(a);
      var pre = document.createElement("pre"); pre.className = "code"; pre.textContent = "Loading " + ex.file;
      card.appendChild(text); card.appendChild(pre);
      box.appendChild(card);
      getFile(ex.file).then(function (t) {
        var r = excerpt(t, ex);
        if (!r) { pre.textContent = "See " + ex.file; return; }
        highlight(pre, r.code);
        a.href = REPO + ex.file + "#L" + r.line;
      }).catch(function () { pre.textContent = "See " + ex.file + " on GitHub."; });
    });
  }

  renderExcerpts("tf-excerpts", [
    { title: "No stored keys: GitHub signs in with OIDC",
      why: "AWS trusts GitHub's identity service instead of an access key. Only workflows from this repository, matched by its permanent account and repo IDs, can assume the deploy role, and each login lasts about an hour.",
      file: "bootstrap/main.tf", marker: 'data "aws_iam_policy_document" "github_trust"' },
    { title: "A deploy role scoped to this project",
      why: "The pipeline's role can touch only this project's two S3 buckets, CloudFront and its certificate. It has no IAM permissions at all, so it cannot grant itself more access.",
      file: "bootstrap/main.tf", marker: 'data "aws_iam_policy_document" "deploy"' },
    { title: "Shared state with locking",
      why: "Terraform's record of what exists lives in an encrypted, versioned S3 bucket instead of on one laptop. A lock file stops two runs from changing the same infrastructure at once.",
      file: "infra/main.tf", marker: 'backend "s3"' },
    { title: "A private bucket only CloudFront can read",
      why: "The S3 bucket blocks all public access. This policy lets one specific CloudFront distribution read the files, so the only way to reach the site is through the CDN over HTTPS.",
      file: "infra/main.tf", marker: 'data "aws_iam_policy_document" "site"' },
    { title: "Custom domain with a free, self-renewing certificate",
      why: "ACM issues the HTTPS certificate for aws.jakemoore.dev. It is validated through DNS and renews on its own, so there is nothing to remember each year.",
      file: "infra/main.tf", marker: 'resource "aws_acm_certificate" "site"' },
    { title: "Security headers on every response",
      why: "CloudFront adds a strict Content Security Policy, HSTS and anti-framing headers to every page, so the browser blocks injected scripts, insecure connections and clickjacking.",
      file: "infra/main.tf", marker: 'resource "aws_cloudfront_response_headers_policy" "security"', max: 24 }
  ]);

  renderExcerpts("ci-excerpts", [
    { title: "1. Triggers",
      why: "Runs on every push to main, on every pull request, and on demand.",
      file: ".github/workflows/deploy.yml", marker: "on:", kind: "yaml" },
    { title: "2. Security scan as a gate",
      why: "Checkov checks the Terraform against AWS best-practice rules before anything else runs. A single failed check stops the deploy.",
      file: ".github/workflows/deploy.yml", marker: "- name: Security scan (Checkov)", kind: "yaml", max: 5 },
    { title: "3. Log in to AWS without a key",
      why: "GitHub hands AWS a signed identity token; AWS returns temporary credentials for the deploy role. The only stored values are the role name and region.",
      file: ".github/workflows/deploy.yml", marker: "- name: Log in to AWS with OIDC", kind: "yaml" },
    { title: "4. Plan",
      why: "Terraform compares the code with what exists in AWS and writes the exact list of changes to a plan file.",
      file: ".github/workflows/deploy.yml", marker: "- name: Plan", kind: "yaml" },
    { title: "5. Apply, on main only",
      why: "Pull requests stop at the plan. A merge to main applies exactly the plan that was shown, then the site files upload to S3.",
      file: ".github/workflows/deploy.yml", marker: "- name: Apply", kind: "yaml" }
  ]);

  /* ---------- source browser ---------- */
  var list = $("file-list"), current = null;
  function open(path, btn) {
    if (current) current.removeAttribute("aria-current");
    btn.setAttribute("aria-current", "true"); current = btn;
    $("file-name").textContent = path;
    $("file-gh").href = REPO + path;
    var pre = $("file-code"); pre.textContent = "Loading...";
    getFile(path).then(function (t) {
      if (current !== btn) return;
      t = t.replace(/\r/g, "").replace(/\n$/, "");
      if (/\.md$/.test(path)) pre.textContent = t; else highlight(pre, t);
    }).catch(function () { if (current === btn) pre.textContent = "Could not load this file."; });
  }
  fetch("source/manifest.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (files) {
    files.forEach(function (path, i) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button"; b.textContent = path;
      b.addEventListener("click", function () { open(path, b); });
      li.appendChild(b); list.appendChild(li);
      if (path === "infra/main.tf") open(path, b);
    });
    if (!current && list.querySelector("button")) list.querySelector("button").click();
  }).catch(function () {
    var li = document.createElement("li"); li.textContent = "File list not available."; list.appendChild(li);
  });

  /* ---------- one live line: when it last deployed ---------- */
  fetch("status/deploy.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.deployed_at || !/^https:\/\//.test(d.commit_url || "")) return;
    var mins = Math.max(0, Math.round((Date.now() - Date.parse(d.deployed_at)) / 60000));
    var ago = mins < 1 ? "just now" : mins < 60 ? mins + " min ago" : mins < 1440 ? Math.round(mins / 60) + " h ago" : Math.round(mins / 1440) + " d ago";
    var el = $("last-deploy");
    el.textContent = "Last deployed " + ago + " from commit ";
    var a = document.createElement("a"); a.href = d.commit_url; a.rel = "noopener"; a.textContent = String(d.commit).slice(0, 7);
    el.appendChild(a);
  }).catch(function () {});
})();
