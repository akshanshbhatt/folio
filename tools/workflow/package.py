"""Package explicitly named input roles, their original paths in the release, and content digests."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile

req=json.load(sys.stdin)
files=req["settings"]["files"]
names=list(files.values())
if not names or len(set(names))!=len(names) or "manifest.json" in names:
    raise ValueError("Declare distinct delivery filenames")
entries={}
with zipfile.ZipFile(req["outputs"]["release"],"w",compression=zipfile.ZIP_STORED) as out:
    for role,name in files.items():
        p=PurePosixPath(name)
        if p.is_absolute() or ".." in p.parts or "\\" in name or str(p)!=name or name==".":
            raise ValueError("Invalid archive path")
        path=Path(req["inputs"][role]);out.write(path,name)
        with path.open("rb") as f:
            h=hashlib.sha256()
            for chunk in iter(lambda:f.read(1024*1024),b""):
                h.update(chunk)
        entries[name]={"role":role,"sha256":h.hexdigest(),"bytes":path.stat().st_size}
    out.writestr("manifest.json",json.dumps({"files":entries},indent=2)+"\n")
