"""Local-file film catalog pages. Data is escaped into each HTML document."""

import json
import html
from pathlib import Path
from urllib.parse import quote

ASSETS = Path(__file__).with_name("catalog_assets")


def esc(value):
    return html.escape(str(value), quote=True)


def url(path):
    return esc(quote(str(path), safe="/-._"))


def json_data(value):
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )


def clock(seconds):
    value = int(round(seconds))
    h, rest = divmod(value, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02}:{s:02}" if h else f"{m}:{s:02}"


def runtime(seconds):
    seconds = round(seconds)
    h, r = divmod(seconds, 3600)
    m, s = divmod(r, 60)
    return (f"{h}h " if h else "") + (f"{m}m " if h or m else "") + f"{s}s"


def label(kind):
    return "Short" if kind == "short" else "Feature"


def header(prefix, name, index=False):
    home = prefix + "index.html"
    return (
        f'<header class="mast"><a class="brand" href="{home}">{esc(name)}</a><div class="mast-nav"><a href="{home}" '
        + ('aria-current="page"' if index else "")
        + '>Library</a><a href="'
        + prefix
        + 'catalog-receipt.txt">Receipt</a></div></header>'
    )


def doc(title, css, body, script=""):
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
        + esc(title)
        + '</title><link rel="stylesheet" href="'
        + css
        + '"></head><body>'
        + body
        + script
        + "</body></html>\n"
    )


def overview(name, items, receipt, has_schedule, rights_links):
    footer_links = (
        '<a href="catalog-schedule.csv">Local release schedule</a>' if has_schedule else ""
    ) + rights_links
    compact = [{k: r[k] for k in ["id", "title", "format", "strand", "question", "time"]} for r in items]
    nojs = "".join(
        '<li><a href="Films/' + url(r["id"]) + '/index.html">' + esc(r["title"]) + "</a></li>" for r in items
    )
    summary = f"{receipt['shorts']} {'Short' if receipt['shorts'] == 1 else 'Shorts'} · {receipt['features']} {'feature' if receipt['features'] == 1 else 'features'} · {runtime(receipt['seconds'])}"
    body = (
        header("", name, True)
        + f"""<main class="wrap"><div class="intro"><div><h1>Film library</h1><p class="summary">{esc(summary)}</p></div></div>
<section class="controls" aria-label="Filter films"><label class="control">Search films<input type="search" id="search" placeholder="Title, question or subject" autocomplete="off"></label>
<label class="control">Subject<select id="strand"><option value="">All subjects</option></select></label>
<div class="tabs" aria-label="Film format"><button data-format="">All films</button><button data-format="short">Shorts</button><button data-format="long">Features</button></div></section>
<p id="results" class="count" aria-live="polite"></p><section class="grid" id="grid" aria-label="Films"></section>
<nav class="pages" aria-label="Result pages"><button id="prev">Previous</button><span id="page-text"></span><button id="next">Next</button></nav>
<noscript><ul class="noscript">{nojs}</ul></noscript>
<footer class="footer">{footer_links}<a href="catalog.json">Catalog data</a></footer></main>"""
    )
    return doc(
        name + " · Film library",
        "catalog-assets/style.css",
        body,
        '<script type="application/json" id="film-data">'
        + json_data(compact)
        + '</script><script src="catalog-assets/browser.js"></script>',
    )


def movie(name, row, e, tl, files, prior, next_item, lang, rights_links):
    def link(f, title):
        return '<a href="' + url("bundle/" + f) + '">' + esc(title) + "</a>"

    files_set = set(files)
    side = [
        ("film.mp4", "Video"),
        ("narration.wav", "Narration"),
        ("captions.srt", "SRT"),
        ("captions.vtt", "WebVTT"),
        ("script.md", "Script"),
        ("direction.md", "Scene direction"),
        ("sources.md", "Source notes and rights"),
        ("poster.png", "Poster"),
        ("timeline.json", "Timeline"),
        ("qc.json", "Render checks"),
    ]
    file_links = "".join(link(k, v) for k, v in side if k in files_set)
    refs = "".join(
        '<li><a href="'
        + esc(s["url"])
        + '">'
        + esc(s["title"])
        + "</a><p>"
        + esc(s["locator"])
        + "</p><p>"
        + esc(s["support"])
        + "</p></li>"
        for s in e["sources"]
    )
    extra = "".join("<li>" + link(k, k) + "</li>" for k in files if k.startswith("project/"))
    credit_rows = [
        a
        for shot in e["shots"]
        for a in ([shot["params"]] if shot["component"] in ("media", "web") else [])
        + ([shot["audioAfter"]] if shot.get("audioAfter") else [])
    ]
    credits = list(dict.fromkeys(a["credit"] + " · " + a["rights"] for a in credit_rows))
    rights = "".join("<li>" + esc(v) + "</li>" for v in credits)

    def neighbour(f, t):
        return (
            '<a href="../' + url(f["id"]) + '/index.html">' + t + " · " + esc(f["title"]) + "</a>"
            if f
            else "<span></span>"
        )

    slot = (
        (
            "<dt>Planned slot</dt><dd>"
            + esc(row["plannedLocal"].replace("T", " at ") + " · " + row["timezone"])
            + "</dd>"
        )
        if row["plannedLocal"]
        else ""
    )
    body = (
        header("../../", name)
        + f"""<main class="wrap"><div class="filmhead"><p class="meta">{label(row["format"])} · {esc(row["strand"])}</p><h1>{esc(row["title"])}</h1></div>
<div class="detail"><div class="player"><video controls playsinline preload="metadata" poster="bundle/poster.png" data-language="{esc(lang)}" aria-label="{esc(row["title"])}"><source src="bundle/film.mp4" type="video/mp4"><a href="bundle/film.mp4">Open video</a></video></div>
<aside class="side"><h2>Film details</h2><dl class="facts"><dt>Duration</dt><dd>{esc(row["time"])}</dd><dt>{esc(row["profile"].title())}</dt><dd>{row["width"]} × {row["height"]} · {row["fps"]} fps</dd>{slot}<dt>Cut</dt><dd>{esc(row["status"])}</dd></dl><div class="links">{file_links}</div></aside></div>
<div class="sections"><section class="section"><h2>Evidence</h2><ol class="evidence">{refs}</ol></section><section class="section"><h2>Project and credits</h2><p>{link("project/episodes/" + e["id"] + ".json", "Editable episode")} · {link("project/", "Project folder")}</p><details><summary>Project files</summary><ul class="pathlist">{extra}</ul></details><ul class="pathlist">{rights}</ul>{rights_links}</section></div>
<footer class="footer pagerlinks">{neighbour(prior, "Previous")}{neighbour(next_item, "Next")}</footer></main>"""
    )
    script = ""
    if "captions.vtt" in files_set:
        script = (
            '<script type="application/json" id="cue-data">'
            + json_data(tl["captions"])
            + '</script><script src="../../catalog-assets/captions.js"></script>'
        )
    return doc(row["title"] + " · " + name, "../../catalog-assets/style.css", body, script)
