"""Check the supplied human edit against the current stage inputs."""
import hashlib
import json
import sys
from pathlib import Path


def fingerprint(obj):
    encoded = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def link_script(edit, approved, verify=False):
    ids = [b["id"] for b in edit["beats"]]
    require(ids and len(set(ids)) == len(ids), "Use distinct script beat IDs")
    for beat in edit["beats"]:
        require(beat["voice"].strip() and beat["claims"], "Every spoken beat needs text and a claim")
        require(set(beat["claims"]) <= approved.keys(), "The script uses a claim outside the accepted evidence")
        citations = [r for claim in beat["claims"] for r in approved[claim]["references"]]
        if verify:
            require(beat.get("references") == citations, "Spoken beat references differ from the accepted claims")
        else:
            beat["references"] = citations


def assemble(request):
    def read(role):
        return json.loads(Path(request["inputs"][role]).read_text(encoding="utf-8"))

    edit = read("edit")
    stage = request["stage"]
    if stage == "claims":
        evidence = read("evidence")
        library = {s["id"]: s["url"] for s in read("selection")["sources"]}
        decisions = {d["claim"]: d for d in edit["decisions"]}
        require(set(decisions) == {c["id"] for c in evidence["claims"]}, "Review each collected claim")
        edit["accepted"] = {}
        for claim in evidence["claims"]:
            decision = decisions[claim["id"]]
            require(decision["reason"] and decision["decision"] in {"accept", "withhold"}, "Document each decision")
            if decision["decision"] == "accept":
                edit["accepted"][claim["id"]] = dict(
                    statement=claim["statement"],
                    references=[{"url": library[c["source"]], "locator": c["locator"]} for c in claim["citations"]])
        edit["openQuestions"] = evidence["openQuestions"]
    elif stage == "script":
        link_script(edit, read("claims")["accepted"])
    elif stage == "storyboard":
        script = read("script")
        link_script(script, read("claims")["accepted"], verify=True)
        require([s["beat"] for s in edit["shots"]] == [b["id"] for b in script["beats"]], "Match the script beats in order")
        for shot in edit["shots"]:
            require(shot["direction"].strip(), "Every beat needs a visual decision")
            for clock in shot.get("clocks", []):
                require(clock["cards"] / clock["fps"] == clock["durationSeconds"], "Incorrect demonstration clock")
    elif stage == "review":
        checked = {role: fingerprint(read(role)) for role in ("script", "board")}
        brand = json.loads(Path(request["brand"]).read_text(encoding="utf-8"))
        checked["brand"] = fingerprint(brand)
        require(checked == edit["reviewedInputs"], "The supplied review belongs to different material; inspect the changed inputs")
        require(edit["decision"] == "accept" and edit["observations"] and edit["historicalLimit"], "Supply the editorial decision")
    else:
        raise ValueError("Unknown history-desk stage: " + stage)
    return edit


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "fingerprint":
            print(fingerprint(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))))
            sys.exit(0)
        req = json.load(sys.stdin)
        result = assemble(req)
        Path(next(iter(req["outputs"].values()))).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    except (KeyError, OSError, ValueError, TypeError) as error:
        sys.exit(str(error))
