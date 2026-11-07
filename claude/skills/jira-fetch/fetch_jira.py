#!/usr/bin/env python3
"""Read-only Jira fetch: tickets (optionally an epic's children) rendered as markdown.

Credentials come from JIRA_URL, JIRA_EMAIL and JIRA_API_TOKEN, either in the
environment or in an env file passed with --env-file. Only HTTP GET is used.

Usage:
  python3 -I fetch_jira.py --env-file ~/.config/dops/project.env KEY-123
  python3 -I fetch_jira.py KEY-1 KEY-2 --brief
  python3 -I fetch_jira.py KEY-100 --children --out tickets/
"""
import argparse
import base64
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

MARK_WRAP = {"strong": "**", "em": "_", "code": "`"}
SPRINT_FIELD = "customfield_10020"
CONFIG = {}


def load_env_file(path):
    values = {}
    for raw in Path(path).expanduser().read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def configure(env_file):
    values = dict(os.environ)
    if env_file:
        values = {**load_env_file(env_file), **{k: v for k, v in os.environ.items() if v}}
    missing = [k for k in ("JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN") if not values.get(k)]
    if missing:
        sys.exit(f"Missing {', '.join(missing)} (set them or pass --env-file)")
    CONFIG["url"] = values["JIRA_URL"].rstrip("/")
    CONFIG["auth"] = base64.b64encode(
        f"{values['JIRA_EMAIL']}:{values['JIRA_API_TOKEN']}".encode()).decode()
    CONFIG["meta"] = tuple(f.strip() for f in values.get("JIRA_META_FIELDS", "").split(",") if f.strip())


def get(path, params=None):
    url = f"{CONFIG['url']}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    req = urllib.request.Request(url, method="GET", headers={
        "Accept": "application/json", "Authorization": f"Basic {CONFIG['auth']}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_issue(key):
    issue = get(f"/rest/api/3/issue/{key}", {"expand": "names"})
    comments, start = [], 0
    while True:
        page = get(f"/rest/api/3/issue/{key}/comment", {"startAt": start, "maxResults": 100})
        comments += page.get("comments", [])
        start += len(page.get("comments", []))
        if not page.get("comments") or start >= page.get("total", 0):
            break
    issue["_comments"] = comments
    return issue


def fetch_children(key):
    out, start = [], 0
    while True:
        data = get("/rest/api/3/search/jql", {
            "jql": f"parent = {key} ORDER BY key ASC",
            "fields": "summary,issuetype,status,assignee",
            "maxResults": 100, "startAt": start})
        out += data.get("issues", [])
        if data.get("isLast", True) or not data.get("issues"):
            return out
        start += len(data["issues"])


def inline(node):
    t = node.get("type")
    if t == "text":
        txt, link = node.get("text", ""), None
        for m in node.get("marks") or []:
            if m.get("type") == "link":
                link = m.get("attrs", {}).get("href")
            elif m.get("type") in MARK_WRAP:
                txt = MARK_WRAP[m["type"]] + txt + MARK_WRAP[m["type"]]
        return f"[{txt}]({link})" if link else txt
    if t == "inlineCard":
        return f"<{node.get('attrs', {}).get('url', '')}>"
    if t == "hardBreak":
        return "\n"
    if t == "mention":
        return "@" + node.get("attrs", {}).get("text", "").lstrip("@")
    if t == "emoji":
        return node.get("attrs", {}).get("text", "")
    return "".join(inline(c) for c in node.get("content") or [])


def block(node, depth=0, out=None):
    out = [] if out is None else out
    t, kids = node.get("type"), node.get("content") or []
    pad = "  " * depth
    if t == "heading":
        lvl = min(node.get("attrs", {}).get("level", 1) + 2, 6)
        out += ["", "#" * lvl + " " + "".join(inline(c) for c in kids)]
    elif t == "paragraph":
        text = "".join(inline(c) for c in kids).strip()
        out += ["", *(pad + l for l in text.split("\n"))] if text else [""]
    elif t in ("bulletList", "orderedList"):
        start = node.get("attrs", {}).get("order", 1)
        for i, li in enumerate(kids):
            bullet = "- " if t == "bulletList" else f"{start + i}. "
            lines = []
            for c in li.get("content") or []:
                block(c, depth + 1, lines)
            lines = [l for l in lines if l.strip()]
            if lines:
                out.append(pad + bullet + lines[0].strip())
                out += ["  " * (depth + 1) + l.strip() for l in lines[1:]]
    elif t == "codeBlock":
        lang = node.get("attrs", {}).get("language", "")
        out += ["", f"```{lang}", *"".join(inline(c) for c in kids).split("\n"), "```"]
    elif t in ("blockquote", "panel"):
        lines = []
        for c in kids:
            block(c, depth, lines)
        out += ["", *(("> " + l).rstrip() for l in lines if l.strip())]
    elif t == "rule":
        out += ["", "---"]
    elif t in ("mediaSingle", "mediaGroup", "mediaInline"):
        for m in kids or [node]:
            a = m.get("attrs", {})
            out += ["", f"_[attachment: {a.get('alt') or a.get('id', 'attachment')}]_"]
    elif t == "table":
        for row in kids:
            cells = [" ".join(l.strip() for l in block(c, 0, []) if l.strip()) for c in row.get("content") or []]
            out.append("| " + " | ".join(cell(c) for c in cells) + " |")
    else:
        for c in kids:
            block(c, depth, out)
    return out


def adf(doc):
    if isinstance(doc, str):
        return doc.strip()
    text, blank = [], True
    for l in block(doc) if doc else []:
        if l.strip():
            text.append(l.rstrip())
            blank = False
        elif not blank:
            text.append("")
            blank = True
    return "\n".join(text).strip()


def opt(v):
    if not v:
        return ""
    if isinstance(v, list):
        return ", ".join(filter(None, (opt(x) for x in v)))
    if isinstance(v, dict):
        return v.get("value") or v.get("name") or v.get("displayName") or v.get("key") or ""
    return str(v)


def cell(s):
    return str(s).replace("|", "\\|").replace("\n", " ")


def brief(issue):
    f = issue["fields"]
    return (f"{issue['key']} | {opt(f.get('status'))} | {opt(f.get('assignee')) or 'Unassigned'}"
            f" | {f['summary']}")


def render(issue, children=None, extra_fields=()):
    f, names, key = issue["fields"], issue.get("names", {}), issue["key"]
    meta = [
        ("Link", f"{CONFIG['url']}/browse/{key}"),
        ("Type", opt(f.get("issuetype"))),
        ("Status", opt(f.get("status"))),
        ("Priority", opt(f.get("priority"))),
        ("Assignee", opt(f.get("assignee")) or "Unassigned"),
        ("Reporter", opt(f.get("reporter"))),
        ("Parent", f"{f['parent']['key']} — {f['parent']['fields']['summary']}" if f.get("parent") else ""),
        ("Sprint", opt(f.get(SPRINT_FIELD))),
        ("Created", (f.get("created") or "")[:10]),
        ("Updated", (f.get("updated") or "")[:10]),
    ] + [(names.get(cf, cf), opt(f.get(cf))) for cf in CONFIG["meta"]]
    lines = [f"# {key} — {f['summary']}", "", "| Field | Value |", "| --- | --- |"]
    lines += [f"| {k} | {cell(v)} |" for k, v in meta if v]

    links = []
    for link in f.get("issuelinks") or []:
        other = link.get("outwardIssue") or link.get("inwardIssue")
        rel = link["type"]["outward" if "outwardIssue" in link else "inward"]
        links.append(f"- {rel} {other['key']} ({opt(other['fields'].get('status'))}) — "
                     f"{other['fields']['summary']}")
    if links:
        lines += ["", "## Linked issues", "", *links]

    if children:
        lines += ["", "## Child work items", "", "| Key | Summary | Status | Assignee |",
                  "| --- | --- | --- | --- |"]
        lines += [f"| {c['key']} | {cell(c['fields']['summary'])} | {cell(opt(c['fields'].get('status')))} "
                  f"| {cell(opt(c['fields'].get('assignee')))} |" for c in children]

    desc = adf(f.get("description"))
    if desc:
        lines += ["", "## Description", "", desc]
    for field in extra_fields:
        text = adf(f.get(field))
        if text:
            lines += ["", f"## {names.get(field, field)}", "", text]

    if issue["_comments"]:
        lines += ["", f"## Comments ({len(issue['_comments'])})"]
        for c in issue["_comments"]:
            lines += ["", f"### {opt(c.get('author'))} — {c.get('created', '')[:16].replace('T', ' ')}",
                      "", adf(c.get("body"))]

    att = f.get("attachment") or []
    if att:
        lines += ["", "## Attachments", ""]
        lines += [f"- {a.get('filename')} ({a.get('mimeType', '')}, {a.get('size', 0) // 1024} KB) "
                  f"{CONFIG['url']}/rest/api/3/attachment/content/{a.get('id')}" for a in att]
    return "\n".join(lines).rstrip() + "\n"


def main():
    p = argparse.ArgumentParser(description="Read-only Jira fetch to markdown.")
    p.add_argument("keys", nargs="+")
    p.add_argument("--env-file", help="file with JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN")
    p.add_argument("--children", action="store_true", help="also fetch the epic's child tickets")
    p.add_argument("--brief", action="store_true", help="one status line per ticket")
    p.add_argument("--out", help="write <KEY>.md files (plus README.md for an epic) to this dir")
    p.add_argument("--field", action="append", default=[], help="extra rich text field to include")
    a = p.parse_args()

    configure(a.env_file)
    if a.out:
        os.makedirs(a.out, exist_ok=True)

    for key in (k.strip().upper() for k in a.keys):
        if a.brief:
            print(brief(get(f"/rest/api/3/issue/{key}", {"fields": "summary,status,assignee"})))
            continue
        issue = fetch_issue(key)
        children = fetch_children(key) if a.children else None
        docs = [(key, render(issue, children, a.field))]
        for c in children or []:
            docs.append((c["key"], render(fetch_issue(c["key"]), extra_fields=a.field)))
        if not a.out:
            print("\n\n".join(md for _, md in docs))
            continue
        for k, md in docs:
            Path(a.out, f"{k}.md").write_text(md)
        if children:
            idx = [f"# {key} — {issue['fields']['summary']}", "", f"See [{key}.md]({key}.md).", "",
                   "| Key | Summary | Status | File |", "| --- | --- | --- | --- |"]
            idx += [f"| {c['key']} | {cell(c['fields']['summary'])} | {cell(opt(c['fields'].get('status')))} "
                    f"| [{c['key']}.md]({c['key']}.md) |" for c in children]
            Path(a.out, "README.md").write_text("\n".join(idx) + "\n")
        print(f"{key}: wrote {len(docs)} file(s) to {a.out}")


if __name__ == "__main__":
    main()
