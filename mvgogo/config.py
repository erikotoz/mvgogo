import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    gbfs_url: str = os.getenv(
        "GBFS_URL", "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ml/gbfs.json"
    )
    otp_url: str = os.getenv("OTP_URL", "http://127.0.0.1:8080/otp/gtfs/v1")
    data_dir: Path = Path(os.getenv("DATA_DIR", "data/cache"))
    max_age: int = int(os.getenv("AVAILABILITY_MAX_AGE", "180"))
    source_manifest: Path = Path(os.getenv("SOURCE_MANIFEST", "data/otp/sources.json"))
