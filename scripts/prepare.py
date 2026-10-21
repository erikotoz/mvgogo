"""Download reproducible OTP inputs; keep large files and snapshots outside Git."""

import argparse
import hashlib
import json
import shutil
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OTP_VERSION = "2.8.1"
OTP_SHA256 = "8ddd736db68846c5d40797d62a6a76dde5d9e6076f23b711311fb8c5b0082749"
SOURCES = {
    "otp.jar": (
        ROOT / "data/tools/otp.jar",
        f"https://repo.maven.apache.org/maven2/org/opentripplanner/otp-shaded/{OTP_VERSION}/otp-shaded-{OTP_VERSION}.jar",
    ),
    "munich.osm.pbf": (
        ROOT / "data/otp/munich.osm.pbf",
        "https://download.bbbike.org/osm/bbbike/Muenchen/Muenchen.osm.pbf",
    ),
    "mvv.gtfs.zip": (
        ROOT / "data/otp/mvv.gtfs.zip",
        "https://www.mvv-muenchen.de/fileadmin/mediapool/developer/opendata/gesamt_gtfs.zip",
    ),
}


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def prepare(force: bool) -> None:
    manifest_path = ROOT / "data/otp/sources.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest = {}
    for name, (path, url) in SOURCES.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        downloaded = force or not path.exists()
        if downloaded:
            print(f"Downloading {name} from {url}", flush=True)
            temporary = path.with_suffix(path.suffix + ".part")
            request = urllib.request.Request(url, headers={"User-Agent": "mvgogo/0.1"})
            try:
                with (
                    urllib.request.urlopen(request, timeout=180) as response,
                    temporary.open("wb") as output,
                ):
                    shutil.copyfileobj(response, output, 1024 * 1024)
                if name == "otp.jar" and digest(temporary) != OTP_SHA256:
                    raise ValueError("OTP checksum mismatch")
                if name.endswith(".zip"):
                    with zipfile.ZipFile(temporary) as archive:
                        required = {"stops.txt", "trips.txt", "stop_times.txt", "routes.txt"}
                        if not required.issubset(archive.namelist()):
                            raise ValueError("Incomplete MVV GTFS archive")
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
        checksum = digest(path)
        if name == "otp.jar" and checksum != OTP_SHA256:
            raise ValueError("OTP checksum mismatch; remove data/tools/otp.jar and retry")
        prior = previous.get(name, {})
        manifest[name] = {
            "url": url,
            "sha256": checksum,
            "retrieved_at": (
                datetime.now(timezone.utc).isoformat()
                if downloaded
                else prior.get(
                    "retrieved_at",
                    datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                )
            ),
        }
    for config in (ROOT / "otp").glob("*.json"):
        shutil.copy2(config, ROOT / "data/otp" / config.name)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print("Ready. Build the graph with: make graph")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Download updated source data")
    prepare(parser.parse_args().refresh)
