import asyncio
import json
import logging
import time
from pathlib import Path

import httpx

from mvgogo.config import Settings

log = logging.getLogger(__name__)


class FeedUnavailable(Exception):
    pass


class Gbfs:
    """Keep station locations usable when live availability fails or expires."""

    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self.client = client
        self.settings = settings
        self.snapshot: dict = {}
        self.next_refresh = 0.0
        self.lock = asyncio.Lock()
        self.failed = False
        try:
            saved = json.loads(self.cache_path.read_text())
            if isinstance(saved.get("information", {}).get("data", {}).get("stations"), list):
                self.snapshot = saved
        except (OSError, ValueError, AttributeError):
            pass

    @property
    def cache_path(self) -> Path:
        return self.settings.data_dir / "stations.json"

    async def fetch(self, url: str) -> dict:
        response = await self.client.get(url)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
            raise TypeError("Invalid GBFS response")
        return payload

    async def refresh(self) -> None:
        async with self.lock:
            if time.monotonic() < self.next_refresh:
                if not self.snapshot.get("information"):
                    raise FeedUnavailable("Station data has not been downloaded yet")
                return
            self.next_refresh = time.monotonic() + 60
            try:
                discovery = await self.fetch(self.settings.gbfs_url)
                languages = discovery["data"]
                feeds = languages.get("en") or languages.get("de") or next(iter(languages.values()))
                urls = {feed["name"]: feed["url"] for feed in feeds["feeds"]}
                names = ["station_information", "station_status", "vehicle_types"]
                results = await asyncio.gather(
                    *(self.fetch(urls[name]) if name in urls else self.missing() for name in names),
                    return_exceptions=True,
                )
                info, status, types = results
                if isinstance(info, Exception):
                    raise info
                if not isinstance(info["data"].get("stations"), list):
                    raise TypeError("Missing station information")
                self.failed = isinstance(status, Exception)
                self.snapshot["information"] = info
                if not isinstance(status, Exception):
                    if not isinstance(status["data"].get("stations"), list):
                        self.failed = True
                    else:
                        self.snapshot["status"] = status
                if not isinstance(types, Exception):
                    self.snapshot["types"] = types
                try:
                    self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = self.cache_path.with_suffix(".tmp")
                    temporary.write_text(json.dumps(self.snapshot))
                    temporary.replace(self.cache_path)
                except OSError:
                    log.warning("Could not persist station snapshot")
            except (httpx.HTTPError, ValueError, KeyError, TypeError, StopIteration):
                self.failed = True
                log.warning("MyRadl refresh failed; using saved station locations")
            if not self.snapshot.get("information"):
                raise FeedUnavailable("Station data has not been downloaded yet")

    @staticmethod
    async def missing():
        raise ValueError("Feed not advertised")

    async def stations(self) -> dict:
        await self.refresh()
        now = time.time()
        status_feed = self.snapshot.get("status", {})
        statuses = {
            str(s["station_id"]): s for s in status_feed.get("data", {}).get("stations", [])
        }
        types = {
            str(t["vehicle_type_id"]): t
            for t in self.snapshot.get("types", {}).get("data", {}).get("vehicle_types", [])
        }
        features = []
        for station in self.snapshot["information"]["data"]["stations"]:
            sid = str(station["station_id"])
            status = statuses.get(sid, {})
            reported = status.get("last_reported", status_feed.get("last_updated"))
            updated = status_feed.get("last_updated")
            # Both transport freshness and the individual station report must be recent.
            fresh = (
                all(
                    isinstance(t, (int, float)) and -60 <= now - t <= self.settings.max_age
                    for t in [reported, updated]
                )
                and not self.failed
            )
            count = status.get("num_bikes_available") if fresh else None
            by_type = []
            if fresh:
                for item in status.get("vehicle_types_available", []):
                    vehicle = types.get(str(item["vehicle_type_id"]), {})
                    by_type.append(
                        {
                            "name": vehicle.get("name", item["vehicle_type_id"]),
                            "propulsion": vehicle.get("propulsion_type"),
                            "count": item["count"],
                        }
                    )
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [station["lon"], station["lat"]]},
                    "properties": {
                        "id": sid,
                        "name": station["name"],
                        "bikes": count,
                        "by_type": by_type,
                        "renting": bool(status.get("is_renting")) if fresh else None,
                        "returning": bool(status.get("is_returning")) if fresh else None,
                        "installed": bool(status.get("is_installed")) if fresh else None,
                        "fresh": fresh,
                        "reported_at": reported,
                        "rental_url": station.get("rental_uris", {}).get("web"),
                        "area": station.get("station_area"),
                    },
                }
            )
        live = sum(f["properties"]["fresh"] for f in features)
        return {
            "type": "FeatureCollection",
            "features": features,
            "meta": {
                "mode": "live" if features and live == len(features) else "stations_only",
                "fresh_stations": live,
                "total_stations": len(features),
                "status_updated_at": status_feed.get("last_updated"),
                "locations_updated_at": self.snapshot["information"].get("last_updated"),
                "max_age_seconds": self.settings.max_age,
                "source": "MyRadl / nextbike GBFS",
            },
        }
