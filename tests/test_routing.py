import asyncio
from datetime import datetime, timezone

import httpx
import pytest
from pydantic import ValidationError

from mvgogo.routing import Router, RouteRequest, RouterUnavailable, normalize


def request(**overrides):
    return RouteRequest(
        **{
            "origin": {"lat": 48.17, "lon": 11.58},
            "destination": {"lat": 48.12, "lon": 11.54},
            "departure": datetime(2026, 10, 21, 22, 30, tzinfo=timezone.utc),
            **overrides,
        }
    )


def itinerary(rental=False):
    departure = int(request().departure.timestamp()) * 1000
    a = {"name": "A", "lat": 48.17, "lon": 11.58, "vehicleRentalStation": None}
    b = {"name": "B", "lat": 48.12, "lon": 11.54, "vehicleRentalStation": None}
    if rental:
        a["vehicleRentalStation"] = {"stationId": "nextbike_ml:123"}
        b["vehicleRentalStation"] = {"stationId": "nextbike_ml:456"}
    return {
        "startTime": departure + 300_000,
        "endTime": departure + 900_000,
        "legs": [
            {
                "mode": "BICYCLE" if rental else "BUS",
                "rentedBike": rental,
                "transitLeg": not rental,
                "duration": 600,
                "startTime": departure + 300_000,
                "endTime": departure + 900_000,
                "from": a,
                "to": b,
                "route": None,
            }
        ],
    }


def test_initial_wait_is_included_in_comparison():
    result = normalize(itinerary(), request(), {})
    assert result["total_seconds"] == 900
    assert result["duration_seconds"] == 600
    assert result["initial_wait_seconds"] == 300


@pytest.mark.parametrize(
    "station",
    [
        {"bikes": 0, "renting": True, "returning": True, "installed": True},
        {"bikes": 5, "renting": False, "returning": True, "installed": True},
        {"bikes": 5, "renting": True, "returning": True, "installed": False},
    ],
)
def test_empty_or_closed_pickup_is_rejected(station):
    assert normalize(itinerary(True), request(), {"123": {"fresh": True, **station}}) is None


def test_closed_return_is_rejected():
    stations = {"456": {"fresh": True, "installed": True, "returning": False}}
    assert normalize(itinerary(True), request(), stations) is None


def test_missing_availability_requires_manual_check():
    result = normalize(itinerary(True), request(), {})
    assert any("проверь" in warning for warning in result["warnings"])


def test_bike_limit_excludes_long_rides():
    assert normalize(itinerary(True), request(max_bike_minutes=5), {}) is None


def test_timezone_is_required():
    with pytest.raises(ValidationError):
        request(departure="2026-10-21T14:00:00")


def test_coordinates_are_bounded_to_munich_region():
    with pytest.raises(ValidationError):
        request(origin={"lat": 52.5, "lon": 13.4})


def test_berlin_date_rollover_and_duplicate_results():
    import json

    async def run():
        variables = []

        def upstream(incoming):
            variables.append(json.loads(incoming.content)["variables"])
            return httpx.Response(
                200, json={"data": {"planConnection": {"edges": [{"node": itinerary()}]}}}
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            result = await Router(client, "https://otp.test").plan(
                request(), {"features": [], "meta": {}}
            )
        assert len(result["routes"]) == 1
        assert all(v["departure"] == "2026-10-22T00:30:00+02:00" for v in variables)
        assert variables[1]["modes"]["transit"]["egress"] == ["WALK", "BICYCLE_RENTAL"]

    asyncio.run(run())


def test_router_outage_is_explicit():
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda incoming: httpx.Response(503))
        ) as client:
            with pytest.raises(RouterUnavailable):
                await Router(client, "https://otp.test").plan(
                    request(), {"features": [], "meta": {}}
                )

    asyncio.run(run())
