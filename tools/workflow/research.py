"""Workflow adapter. Discover scholarly leads or bind claims to passages in selected sources."""
import argparse
import datetime
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

LIMIT = 4 * 1024 * 1024

class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "template"}:
            self.hidden += 1
        if tag in {"p", "div", "li", "br", "h1", "h2", "h3", "td", "section", "tr"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "template"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "div", "li", "section", "td", "tr"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)

def fetch(url):
    if urlparse(url).scheme not in {"http", "https"}:
        raise ValueError("Select an HTTP(S) address or supply a declared local input")
    request = Request(url, headers={"User-Agent": "Folio-research/1.0"})
    with urlopen(request, timeout=25) as response:
        raw = response.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError("Source exceeds 4 MiB. Supply a selected text extract.")
        return raw, response.geturl(), response.headers.get_content_type(), response.headers.get_content_charset() or "utf-8"

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def dump(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def discover(req):
    brief = read_json(req["inputs"]["brief"])
    query = brief["query"]
    limit = brief.get("limit", 6)
    if not isinstance(query, str) or not query.strip() or type(limit) is not int or not 1 <= limit <= 20:
        raise ValueError("Use a query and a limit between 1 and 20")
    url = "https://api.crossref.org/works?" + urlencode({"query.bibliographic": query, "rows": limit})
    raw, final, _, _ = fetch(url)
    works = json.loads(raw)["message"]["items"]
    rows = [{"title": (item.get("title") or [""])[0], "doi": item.get("DOI"), "url": item.get("URL"),
             "published": item.get("published", {}).get("date-parts"), "type": item.get("type")} for item in works]
    return {"kind": "research-leads", "query": query, "endpoint": final, "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "leads": rows}

def required(row, key):
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Missing nonempty " + key)
    return value

def collect(req):
    selection = read_json(req["inputs"]["selection"])
    texts, records, claims = {}, [], []
    for source in selection["sources"]:
        ident = required(source, "id")
        if ident in texts:
            raise ValueError("Duplicate source " + ident)
        title = required(source, "title")
        rights = required(source, "rights")
        if "input" in source:
            file = Path(req["inputs"][source["input"]])
            if file.stat().st_size > LIMIT:
                raise ValueError("Local source exceeds 4 MiB")
            raw = file.read_bytes()
            origin = {"input": source["input"]}
            if "url" in source:
                origin["url"] = required(source, "url")
            kind, enc = source.get("format", "text/plain"), "utf-8"
        else:
            raw, final, kind, enc = fetch(required(source, "url"))
            origin = {"url": source["url"], "retrievedUrl": final,
                      "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        if kind not in {"text/plain", "text/markdown", "text/html", "application/xhtml+xml", "application/json"}:
            raise ValueError("Use an HTML or text source, or supply a text extract for " + ident)
        text = raw.decode(enc)
        if "html" in kind:
            parser = VisibleText(); parser.feed(text); parser.close(); text = "".join(parser.parts)
        texts[ident] = " ".join(text.split())
        record = dict(id=ident, title=title, rights=rights, sha256=hashlib.sha256(raw).hexdigest(), **origin)
        if req.get("settings", {}).get("includeNormalizedText") is True:
            record["normalizedText"] = texts[ident]
        records.append(record)
    seen = set()
    for claim in selection["claims"]:
        ident = required(claim, "id")
        if ident in seen:
            raise ValueError("Duplicate claim " + ident)
        seen.add(ident)
        statement = required(claim, "statement")
        citations = []
        for ref in claim["references"]:
            src = required(ref, "source")
            quote = " ".join(required(ref, "quote").split())
            locator = required(ref, "locator")
            body = texts[src]; pos = body.find(quote)
            if pos < 0:
                raise ValueError("Passage missing for claim " + ident + " in " + src)
            if "occurrence" not in ref and body.find(quote, pos + 1) >= 0:
                raise ValueError("Select a quote occurrence for " + ident)
            occurrence = ref.get("occurrence", 1)
            if type(occurrence) is not int or occurrence < 1:
                raise ValueError("Invalid quote occurrence")
            for _ in range(occurrence - 1):
                pos = body.find(quote, pos + 1)
                if pos < 0:
                    raise ValueError("Missing quote occurrence for " + ident)
            citations.append(dict(source=src, quote=quote, locator=locator, normalizedRange=[pos, pos+len(quote)]))
        if not citations:
            raise ValueError("A supported claim needs at least one passage: " + ident)
        claims.append(dict(id=ident, statement=statement, citations=citations))
    return {"kind": "evidence", "sources": records, "claims": claims, "openQuestions": selection.get("openQuestions", []),
            "check": "Quoted passages located in the selected materials. Assess interpretation, independence and rights during editorial review."}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["discover", "collect"])
    args = parser.parse_args()
    req = json.load(sys.stdin)
    if args.action == "discover":
        dump(req["outputs"]["leads"], discover(req))
    else:
        dump(req["outputs"]["evidence"], collect(req))

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as err:
        sys.exit(str(err))
