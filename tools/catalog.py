#!/usr/bin/env python3
"""Build or verify a portable, offline Folio library from finished render bundles."""

import argparse
import csv
import errno
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from catalog_ui import ASSETS, clock, esc, movie, overview, runtime, url

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "folio-offline-catalog-v1"
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DESKTOP_METADATA = {".DS_Store", "Thumbs.db", "desktop.ini"}
IMPORT = re.compile(r"""(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]""")


def require(test, detail):
    if not test:
        raise ValueError(detail)


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def stamp(path):
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return {"bytes": size, "sha256": digest.hexdigest()}


def inventory(root, strict_dirs=False):
    files = {}
    directories = set()
    for path in root.rglob("*"):
        require(not path.is_symlink(), f"Unexpected symbolic link: {path}")
        if path.is_file():
            if path.name not in DESKTOP_METADATA:
                files[path.relative_to(root).as_posix()] = path
        else:
            require(path.is_dir(), f"Unexpected file type: {path}")
            directories.add(path.relative_to(root))
    if strict_dirs:
        parents = {p for f in files for p in Path(f).parents if p != Path(".")}
        require(directories == parents, "Catalog contains an unrelated empty directory")
    return files


def copy_asset(source, target, copy):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not copy:
        try:
            os.link(source, target)
            return
        except OSError as error:
            if error.errno not in {errno.EXDEV, errno.EPERM, errno.EACCES, errno.ENOTSUP}:
                raise
    shutil.copy2(source, target)


def source_files(channel, ep, brand):
    seen = set()
    scanned = set()

    def take(relative, scan=False):
        path = Path(os.path.abspath(channel / relative))
        require(path.resolve().is_relative_to(channel), f"Source outside channel: {relative}")
        seen.add(path)
        if scan and path not in scanned:
            scanned.add(path)
            for dep in IMPORT.findall(path.read_text(encoding="utf-8")):
                take(path.parent / dep, True)

    for registry in brand.get("plugins", {}).values():
        for plugin in registry.values():
            take(plugin, True)
    for font in brand.get("fonts", []):
        take(font["file"])
        if font.get("license"):
            take(font["license"])
    for shot in ep["shots"]:
        params = shot.get("params", {})
        if shot["component"] in ("media", "web"):
            take(params["file"])
        else:
            name = shot["component"] + ".mjs"
            path = next((p for folder in brand["modules"] if (p := channel / folder / name).is_file()), None)
            require(path, f"Missing component: {name}")
            take(path, True)
        for asset in params.get("dependencies", []):
            take(asset)
        if shot.get("audioAfter"):
            take(shot["audioAfter"]["file"])
    return seen


def render_bundle(channel, renders, brand, slug, profile, full_decode, watched=None):
    root = renders / slug / profile
    pointer = read(root / "latest.json")
    rev = pointer["revision"]
    require(re.fullmatch("[a-f0-9]{20}", rev) and pointer["profile"] == profile, f"Invalid pointer: {slug}")
    bundle = root / rev
    require(bundle.resolve().is_relative_to(renders), f"Bundle escaped render root: {slug}")
    files = inventory(bundle)
    require(
        "receipt.json" in files, f"{slug} has no renderer receipt. Render it with the current Folio CLI."
    )
    native = read(files["receipt.json"])
    require(
        native["version"] == 1 and native["revision"] == rev and native["algorithm"] == "sha256",
        f"Invalid receipt: {slug}",
    )
    expected = native["files"]
    require(set(expected) == set(files) - {"receipt.json"}, f"Incomplete bundle inventory: {slug}")
    for name, signed in expected.items():
        require(stamp(files[name]) == signed, f"Render asset changed: {slug}/{name}")
    ep = read(channel / "episodes" / (slug + ".json"))
    require(
        ep["id"] == slug and ep == read(files[f"project/episodes/{slug}.json"]),
        f"Script changed since render: {slug}",
    )
    require(
        all(urlsplit(s["url"]).scheme in ("http", "https") for s in ep["sources"]),
        "Sources must use HTTP or HTTPS",
    )
    require(brand == read(files["project/brand.json"]), f"Brand changed since render: {slug}")
    for path in source_files(channel, ep, brand):
        key = "project/" + path.relative_to(channel).as_posix()
        require(expected.get(key) == stamp(path), f"Source changed since render: {slug}/{key}")
        if watched is not None:
            previous = watched.setdefault(path, expected[key])
            require(previous == expected[key], f"Source changed between selected renders: {key}")
    qc = read(files["qc.json"])
    tl = read(files["timeline.json"])
    require(
        qc["fullDecode"]
        and qc["profile"] == profile
        and qc["revision"] == tl["revision"] == rev
        and qc["subtitleMode"] == pointer["subtitles"],
        f"Render checks disagree: {slug}",
    )
    if full_decode:
        subprocess.run(
            ["node", ROOT / "src/cli.mjs", "verify", bundle], check=True, stdout=subprocess.DEVNULL
        )
    return ep, qc, tl, files


def release_slots(channel, renders, brand):
    if not brand.get("schedule"):
        return {}
    command = ["node", ROOT / "src/cli.mjs", "schedule", "--channel", channel, "--out", renders]
    schedule = subprocess.check_output(command, text=True)
    return {row["id"]: row for row in csv.DictReader(io.StringIO(schedule)) if row["id"]}


def verify(output, full_decode=False):
    members = inventory(output, strict_dirs=True)
    cat = read(output / "catalog.json")
    require(cat.get("schema") in (SCHEMA, "foliofilm-offline-catalog-v1"), "Output does not contain a Folio catalog")
    signed = cat["files"]
    require(set(members) == set(signed) | {"catalog.json"}, "Catalog contains missing or unrelated files")
    for name, expected in signed.items():
        require(stamp(members[name]) == expected, f"Catalog asset changed: {name}")
    rows = cat["films"]
    ids = [r["id"] for r in rows]
    require(
        ids and len(set(ids)) == len(ids) and all(SLUG.fullmatch(s) for s in ids), "Invalid catalog ID list"
    )
    film_ids = {p.name for p in (output / "Films").iterdir() if p.name not in DESKTOP_METADATA}
    require(film_ids == set(ids), "Unexpected catalog film directory")
    for row in rows:
        prefix = "Films/" + row["id"] + "/bundle/"
        native = read(members[prefix + "receipt.json"])
        require(
            native["version"] == 1
            and native["algorithm"] == "sha256"
            and native["revision"] == row["revision"],
            "Invalid film receipt",
        )
        actual = {
            k[len(prefix) :]: v
            for k, v in signed.items()
            if k.startswith(prefix) and k != prefix + "receipt.json"
        }
        require(native["files"] == actual, f"Film receipt differs: {row['id']}")
        qc = read(members[prefix + "qc.json"])
        ep = read(members[prefix + "project/episodes/" + row["id"] + ".json"])
        require(
            row["title"] == ep["title"]
            and row["format"] == ep["format"]
            and row["revision"] == qc["revision"]
            and row["frames"] == qc["frames"]
            and row["fps"] == qc["fps"],
            f"Film metadata differs: {row['id']}",
        )
        if full_decode:
            subprocess.run(
                ["node", ROOT / "src/cli.mjs", "verify", output / prefix],
                check=True,
                stdout=subprocess.DEVNULL,
            )
    return cat


def put_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build(stage, args):
    channel, renders = args.channel, args.renders
    brand = read(channel / "brand.json")
    originals = sorted(p.stem for p in (channel / "episodes").glob("*.json"))
    require(all(SLUG.fullmatch(s) for s in originals), "Invalid episode filename")
    selected = args.episode or [
        s for s in originals if (renders / s / args.profile / "latest.json").is_file()
    ]
    require(
        selected and len(set(selected)) == len(selected) and set(selected) <= set(originals),
        "Select finished, distinct episode IDs from this channel",
    )
    schedule = release_slots(channel, renders, brand)
    order = {slug: i for i, slug in enumerate(schedule)}
    selected = sorted(selected, key=lambda slug: (order.get(slug, len(order)), slug))
    slate = channel / "slate.json"
    strands = {r["id"]: r.get("strand") for r in read(slate)} if slate.exists() else {}
    rights = []
    for name in ("LICENSE", "LICENSE.md", "LICENSE.txt", "NOTICE", "NOTICE.md", "NOTICE.txt"):
        if (channel / name).is_file():
            copy_asset(channel / name, stage / "Source" / name, args.copy)
            rights.append(name)

    def rights_links(prefix):
        return " ".join(f'<a href="{prefix}Source/{url(f)}">{esc(f)}</a>' for f in rights)

    rows, pages, watched = [], [], {}
    for slug in selected:
        ep, qc, timeline, files = render_bundle(
            channel, renders, brand, slug, args.profile, args.full_decode, watched
        )
        slot = schedule.get(slug, {})
        row = dict(
            id=slug,
            title=ep["title"],
            format=ep["format"],
            question=ep["question"],
            strand=strands.get(slug) or ep.get("strand") or brand.get("series") or "Films",
            time=clock(qc["seconds"]),
            frames=qc["frames"],
            fps=qc["fps"],
            revision=qc["revision"],
            width=qc["width"],
            height=qc["height"],
            profile=qc["profile"],
            status=qc["editorialStatus"],
            plannedLocal=slot.get("local"),
            timezone=slot.get("timezone"),
        )
        rows.append(row)
        folder = stage / "Films" / slug
        for filename, source in files.items():
            copy_asset(source, folder / "bundle" / filename, args.copy)
        pages.append((ep, timeline, sorted(files)))
    for i, (row, (ep, timeline, names)) in enumerate(zip(rows, pages)):
        lang = brand.get("voice", {}).get("lang", "und")
        page = movie(
            brand["name"],
            row,
            ep,
            timeline,
            names,
            rows[i - 1] if i else None,
            rows[i + 1] if i + 1 < len(rows) else None,
            lang,
            rights_links("../../"),
        )
        put_text(stage / "Films" / row["id"] / "index.html", page)
    total = sum(r["frames"] / r["fps"] for r in rows)
    shorts = sum(r["format"] == "short" for r in rows)
    summary = dict(shorts=shorts, features=len(rows) - shorts, seconds=total)

    def count(n, singular):
        return f"{n} {singular if n == 1 else singular + 's'}"

    counts = " · ".join(
        [
            count(len(rows), "film"),
            count(shorts, "Short"),
            count(len(rows) - shorts, "feature"),
            runtime(total),
        ]
    )
    put_text(stage / "catalog-receipt.txt", f"{brand['name']}\n{counts}\nProfile: {args.profile}\n")
    planned = [row for row in rows if row["plannedLocal"]]
    if planned:
        with (stage / "catalog-schedule.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["id", "local", "timezone", "title"])
            writer.writerows((r["id"], r["plannedLocal"], r["timezone"], r["title"]) for r in planned)
    colors = brand.get("theme", {})
    palette = {
        key: val
        for key, val in colors.items()
        if isinstance(val, str) and re.fullmatch(r"#[a-fA-F0-9]{6}", val)
    }
    css = (ASSETS / "style.css").read_text(encoding="utf-8")
    if "paper" in palette and "ink" in palette:
        css += (
            "\n.mast{background:"
            + palette["paper"]
            + ";color:"
            + palette["ink"]
            + "}.mast-nav a{color:inherit}"
        )
    put_text(stage / "catalog-assets/style.css", css)
    for name in ("browser.js", "captions.js"):
        shutil.copy2(ASSETS / name, stage / "catalog-assets" / name)
    put_text(stage / "index.html", overview(brand["name"], rows, summary, bool(planned), rights_links("")))
    cat = dict(
        schema=SCHEMA,
        channel=brand["name"],
        profile=args.profile,
        films=rows,
        files={name: stamp(path) for name, path in inventory(stage).items()},
    )
    put_text(stage / "catalog.json", json.dumps(cat, ensure_ascii=False, indent=2) + "\n")
    return rows, brand, watched


def check_current(stage, args, rows, brand, watched):
    require(read(args.channel / "brand.json") == brand, "Brand changed during collection")
    for path, expected in watched.items():
        require(stamp(path) == expected, f"Source changed during collection: {path}")
    for row in rows:
        slug = row["id"]
        source = Path("episodes") / (slug + ".json")
        require(
            read(args.channel / source) == read(stage / "Films" / slug / "bundle/project" / source),
            f"Episode changed during collection: {slug}",
        )
        require(
            read(args.renders / slug / args.profile / "latest.json")["revision"] == row["revision"],
            f"Revision changed during collection: {row['id']}",
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", type=Path, help="Channel containing brand.json and episodes/")
    parser.add_argument(
        "--renders", type=Path, default=Path("renders"), help="Root passed to folio render --out"
    )
    parser.add_argument("--output", type=Path, required=True, help="Dedicated directory for the offline site")
    parser.add_argument(
        "--episode", action="append", help="Select this episode; repeatable. Default: all finished episodes."
    )
    parser.add_argument("--profile", choices=["master", "review"], default="master")
    parser.add_argument(
        "--copy",
        action="store_true",
        help="Use independent copies. Default: hardlink locally, copy across filesystems.",
    )
    parser.add_argument(
        "--full-decode",
        action="store_true",
        help="Run the renderer’s full audio/video verifier while collecting.",
    )
    parser.add_argument(
        "--verify-only", action="store_true", help="Verify an existing portable catalog without source files."
    )
    args = parser.parse_args()
    require(not args.output.is_symlink(), "Choose a directory instead of a symbolic link")
    output = args.output.resolve()
    if args.verify_only:
        cat = verify(output, args.full_decode)
        if args.channel:
            channel, renders = args.channel.resolve(), args.renders.resolve()
            brand = read(channel / "brand.json")
            for row in cat["films"]:
                _, qc, _, _ = render_bundle(channel, renders, brand, row["id"], row["profile"], False)
                require(qc["revision"] == row["revision"], f"A newer render is available: {row['id']}")
        count = len(cat["films"])
        print(f"Verified {count} {'film' if count == 1 else 'films'} in {output}")
        return
    require(args.channel, "Collection requires --channel")
    args.channel, args.renders = args.channel.resolve(), args.renders.resolve()
    for source in (args.channel, args.renders):
        require(
            not source.is_relative_to(output) and not output.is_relative_to(source),
            "Keep catalog output separate from the channel and render root",
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    guard = output.parent / ("." + output.name + ".catalog-lock")
    guard.mkdir()
    try:
        prior = None
        if output.exists():
            require(output.is_dir(), "Output is not a directory")
            if any(output.iterdir()):
                old = verify(output)
                require(
                    old["channel"] == read(args.channel / "brand.json")["name"],
                    "Existing catalog belongs to a different channel",
                )
                prior = stamp(output / "catalog.json")
        with tempfile.TemporaryDirectory(prefix=".folio-collect-", dir=output.parent) as temp:
            stage, backup = Path(temp) / "new", Path(temp) / "old"
            stage.mkdir()
            current = build(stage, args)
            verify(stage)
            if output.exists():
                if prior:
                    require(stamp(output / "catalog.json") == prior, "Catalog changed during assembly")
                    verify(output)
                    for source in output.rglob("*"):
                        if source.name in DESKTOP_METADATA and source.is_file():
                            target = stage / source.relative_to(output)
                            require(target.parent.is_dir(), f"Choose a new output to preserve {source}")
                            shutil.copy2(source, target)
                else:
                    require(not any(output.iterdir()), "Output changed during assembly")
            check_current(stage, args, *current)
            if output.exists():
                output.rename(backup)
            try:
                if backup.exists():
                    if prior:
                        expected_paths = set(old["files"]) | {"catalog.json"}
                        require(
                            set(inventory(backup, strict_dirs=True)) == expected_paths,
                            "Output gained an unrelated file",
                        )
                    else:
                        require(not any(backup.iterdir()), "Output gained an unrelated file")
                stage.rename(output)
            except BaseException:
                if backup.exists():
                    backup.rename(output)
                raise
    finally:
        guard.rmdir()
    print((output / "catalog-receipt.txt").read_text().strip())
    print(output / "index.html")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        sys.exit("Catalog: " + str(error))
