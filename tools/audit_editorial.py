"""Audit the commissioned slate and shot-to-source assignments in one channel."""

import argparse
from collections import Counter
import json
from pathlib import Path
from urllib.parse import urlsplit


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def repeated(values):
    return sorted(key for key, count in Counter(values).items() if count > 1)


def audit(channel):
    slate = read(channel / "slate.json")
    scripts = [read(path) for path in sorted((channel / "episodes").glob("*.json"))]
    allocation = {row["id"]: row for row in slate}
    commissioned = set(allocation)
    authored = {episode["id"] for episode in scripts}
    errors = []
    for label, values in [
        ("duplicate slate IDs", repeated(item["id"] for item in slate)),
        ("duplicate slate titles", repeated(item["title"] for item in slate)),
        ("duplicate episode IDs", repeated(item["id"] for item in scripts)),
        ("commissioned without script", sorted(commissioned - authored)),
        ("authored outside commission", sorted(authored - commissioned)),
    ]:
        if values:
            errors.append({label: values})

    source_records = 0
    shots = 0
    assignments = 0
    unchanged_leads = 0
    one_url = 0
    urls = set()
    scripts_seen = {}
    for episode in scripts:
        episode_id = episode["id"]
        sources = {item["id"]: item for item in episode["sources"]}
        local_urls = {item["url"] for item in sources.values()}
        used = set()
        source_records += len(episode["sources"])
        urls.update(local_urls)
        one_url += len(local_urls) == 1
        if len(sources) != len(episode["sources"]):
            errors.append(f"{episode_id}: duplicate source ID")
        pitch = allocation.get(episode_id)
        if pitch:
            unchanged_leads += pitch["sourceLead"] in local_urls
            if pitch["format"] != episode["format"]:
                errors.append(f"{episode_id}: format differs from order")
        for item in sources.values():
            if any(not str(item.get(field, "")).strip() for field in
                   ("id", "title", "url", "locator", "support")):
                errors.append(f"{episode_id}/{item['id']}: incomplete source")
            url = urlsplit(item["url"])
            if url.scheme not in {"http", "https"} or not url.hostname:
                errors.append(f"{episode_id}/{item['id']}: malformed source URL")
        for shot in episode["shots"]:
            shots += 1
            refs = shot["refs"]
            assignments += len(refs)
            used.update(refs)
            if not refs or set(refs) - sources.keys():
                errors.append(f"{episode_id}/{shot['id']}: empty or unresolved refs")
        if sources.keys() - used:
            errors.append(f"{episode_id}: unused bibliography entry")
        narration = " ".join(" ".join(shot["voice"].split()) for shot in episode["shots"])
        if narration in scripts_seen:
            errors.append(f"{episode_id}: same narration as {scripts_seen[narration]}")
        scripts_seen[narration] = episode_id

    return {
        "slate": dict(Counter(row["format"] for row in slate)),
        "authored": dict(Counter(item["format"] for item in scripts)),
        "strands": len({row["strand"] for row in slate}),
        "shots": shots, "shotSourceAssignments": assignments,
        "sourceRecords": source_records, "distinctSourceUrls": len(urls),
        "distinctSourceHosts": len({urlsplit(url).hostname for url in urls}),
        "episodesWithOneSourceUrl": one_url, "episodesUsingOriginalLead": unchanged_leads,
        "errors": errors,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("channel", type=Path)
    result = audit(parser.parse_args().channel)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(int(bool(result["errors"])))
