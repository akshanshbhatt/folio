"""Install an isolated Kokoro runtime and verify the upstream model files."""

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".voice"
MODEL_ROOT = ENV / "models"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
ASSETS = {
    "kokoro-v1.0.int8.onnx": "ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def install_model(name, checksum):
    path = MODEL_ROOT / name
    if path.is_file() and sha256(path) == checksum:
        return
    print(f"Downloading {name}", flush=True)
    with tempfile.NamedTemporaryFile(dir=MODEL_ROOT, delete=False) as partial:
        temporary = Path(partial.name)
    try:
        # curl honors local trust stores and follows GitHub's release redirect.
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--silent",
                        "--show-error", "--output", str(temporary), f"{RELEASE}/{name}"],
                       check=True)
        if sha256(temporary) != checksum:
            raise ValueError(f"Upstream SHA-256 mismatch for {name}")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    python = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.is_file():
        env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(ROOT / ".toolchains"))
        subprocess.run(["uv", "venv", "--python", "3.12", str(ENV)], env=env, check=True)
    subprocess.run(["uv", "pip", "install", "--python", str(python),
                    "-r", str(ROOT / "tools" / "voice-requirements.txt")], check=True)
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    for name, checksum in ASSETS.items():
        install_model(name, checksum)
    print("Voice runtime ready.")


if __name__ == "__main__":
    main()
