import asyncio
import math
import time
from collections import OrderedDict

import httpx


class GeocoderUnavailable(Exception):
    pass


class Geocoder:
    """Explicit user searches with a bounded cache and a shared request rate limit."""

    def __init__(self, client: httpx.AsyncClient, url: str):
        self.client = client
        self.url = url
        self.lock = asyncio.Lock()
        self.next_request = 0.0
        self.cache: OrderedDict[str, tuple[float, list[dict]]] = OrderedDict()

    async def search(self, query: str) -> list[dict]:
        key = " ".join(query.casefold().split())
        async with self.lock:
            saved = self.cache.get(key)
            if saved and time.monotonic() - saved[0] < 86400:
                self.cache.move_to_end(key)
                return saved[1]
            await asyncio.sleep(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + 1.1
            try:
                response = await self.client.get(
                    self.url,
                    params={
                        "q": query,
                        "limit": 5,
                        "lang": "de",
                        "lat": 48.137,
                        "lon": 11.575,
                        "bbox": "10.8,47.8,12.3,48.6",
                    },
                    headers={"User-Agent": "mvgogo/0.2 (https://github.com/erikotoz/mvgogo)"},
                )
                response.raise_for_status()
                features = response.json()["features"]
                if not isinstance(features, list):
                    raise TypeError("Invalid geocoder response")
                results = []
                for feature in features:
                    lon, lat = map(float, feature["geometry"]["coordinates"][:2])
                    if not (
                        math.isfinite(lat)
                        and math.isfinite(lon)
                        and 47.8 <= lat <= 48.6
                        and 10.8 <= lon <= 12.3
                    ):
                        continue
                    p = feature["properties"]
                    address = " ".join(str(p[k]) for k in ["street", "housenumber"] if p.get(k))
                    parts = list(
                        dict.fromkeys(
                            str(x)
                            for x in [
                                p.get("name"),
                                address,
                                p.get("postcode"),
                                p.get("city") or p.get("town") or p.get("village"),
                            ]
                            if x
                        )
                    )
                    label = ", ".join(parts) or f"{lat:.5f}, {lon:.5f}"
                    if not any(r["lat"] == lat and r["lon"] == lon for r in results):
                        results.append({"label": label, "lat": lat, "lon": lon})
            except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
                raise GeocoderUnavailable("Place search is unavailable") from exc
            self.cache[key] = (time.monotonic(), results)
            while len(self.cache) > 256:
                self.cache.popitem(last=False)
            return results
