import asyncio

import httpx
import pytest

from mvgogo.geocoding import Geocoder, GeocoderUnavailable


def feature(lon=11.575, lat=48.137):
    return {
        "geometry": {"coordinates": [lon, lat]},
        "properties": {
            "name": "Marienplatz",
            "city": "München",
            "postcode": "80331",
        },
    }


def test_search_filters_region_deduplicates_and_caches():
    async def run():
        calls = []

        def upstream(request):
            calls.append(request)
            return httpx.Response(
                200, json={"features": [feature(), feature(), feature(13.4, 52.5)]}
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            geocoder = Geocoder(client, "https://places.test/api/")
            results = await geocoder.search("Marienplatz München")
            assert len(results) == 1
            assert results[0]["label"] == "Marienplatz, 80331, München"
            assert await geocoder.search("  MARIENPLATZ   München ") == results
            assert len(calls) == 1
            assert calls[0].url.params["bbox"] == "10.8,47.8,12.3,48.6"
            assert "mvgogo" in calls[0].headers["user-agent"]

    asyncio.run(run())


@pytest.mark.parametrize(
    "response", [httpx.Response(503), httpx.Response(200, json={"features": None})]
)
def test_failed_or_malformed_provider_is_explicit(response):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: response)
        ) as client:
            with pytest.raises(GeocoderUnavailable):
                await Geocoder(client, "https://places.test/api/").search("Marienplatz")

    asyncio.run(run())
