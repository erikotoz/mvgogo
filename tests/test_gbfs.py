import asyncio
import json
import time

import httpx
import pytest

from mvgogo.config import Settings
from mvgogo.gbfs import FeedUnavailable, Gbfs


def payloads(now):
    return {
        "/discovery": {
            "data": {
                "en": {
                    "feeds": [
                        {"name": name, "url": f"https://feed.test/{name}"}
                        for name in ["station_information", "station_status", "vehicle_types"]
                    ]
                }
            }
        },
        "/station_information": {
            "last_updated": now,
            "data": {
                "stations": [
                    {
                        "station_id": "123",
                        "name": "Test station",
                        "lat": 48.1,
                        "lon": 11.5,
                    }
                ]
            },
        },
        "/station_status": {
            "last_updated": now,
            "data": {
                "stations": [
                    {
                        "station_id": "123",
                        "num_bikes_available": 4,
                        "last_reported": now,
                        "is_renting": True,
                        "is_returning": True,
                        "is_installed": True,
                    }
                ]
            },
        },
        "/vehicle_types": {"data": {"vehicle_types": []}},
    }


def test_live_then_failed_feed_hides_count_but_keeps_station(tmp_path):
    async def run():
        documents = payloads(time.time())
        failed = False

        def upstream(request):
            if failed and request.url.path == "/station_status":
                return httpx.Response(503)
            return httpx.Response(200, json=documents[request.url.path])

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            feed = Gbfs(client, Settings(gbfs_url="https://feed.test/discovery", data_dir=tmp_path))
            live = await feed.stations()
            assert live["features"][0]["properties"]["bikes"] == 4
            assert live["meta"]["mode"] == "live"
            failed = True
            feed.next_refresh = 0
            fallback = await feed.stations()
            assert len(fallback["features"]) == 1
            assert fallback["features"][0]["properties"]["bikes"] is None
            assert fallback["features"][0]["properties"]["returning"] is None
            assert fallback["meta"]["mode"] == "stations_only"

    asyncio.run(run())


@pytest.mark.parametrize("station_age,feed_age", [(600, 0), (0, 600), (-120, 0)])
def test_stale_or_future_timestamps_are_not_live(tmp_path, station_age, feed_age):
    async def run():
        now = time.time()
        documents = payloads(now)
        documents["/station_status"]["last_updated"] = now - feed_age
        documents["/station_status"]["data"]["stations"][0]["last_reported"] = now - station_age
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json=documents[request.url.path])
            )
        ) as client:
            feed = Gbfs(client, Settings(gbfs_url="https://feed.test/discovery", data_dir=tmp_path))
            result = await feed.stations()
            assert result["features"][0]["properties"]["bikes"] is None

    asyncio.run(run())


def test_restart_uses_disk_locations_when_offline(tmp_path):
    documents = payloads(time.time() - 600)
    (tmp_path / "stations.json").write_text(
        json.dumps(
            {
                "information": documents["/station_information"],
                "status": documents["/station_status"],
            }
        )
    )

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(503))
        ) as client:
            result = await Gbfs(client, Settings(data_dir=tmp_path)).stations()
            assert result["features"][0]["properties"]["name"] == "Test station"
            assert result["features"][0]["properties"]["bikes"] is None

    asyncio.run(run())


def test_initial_outage_remains_503_during_retry_window(tmp_path):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(503))
        ) as client:
            feed = Gbfs(client, Settings(data_dir=tmp_path))
            for _ in range(2):
                with pytest.raises(FeedUnavailable):
                    await feed.stations()

    asyncio.run(run())
