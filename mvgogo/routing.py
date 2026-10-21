import asyncio
from datetime import datetime, timezone
from itertools import pairwise
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from pydantic import BaseModel, Field, field_validator

BERLIN = ZoneInfo("Europe/Berlin")
QUERY = (Path(__file__).parent / "plan.graphql").read_text()


class Point(BaseModel):
    lat: float = Field(ge=47.8, le=48.6, allow_inf_nan=False)
    lon: float = Field(ge=10.8, le=12.3, allow_inf_nan=False)


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    departure: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    max_walk_minutes: int = Field(default=30, ge=1, le=60)
    max_bike_minutes: int = Field(default=30, ge=1, le=120)

    @field_validator("departure")
    @classmethod
    def aware_departure(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("departure must include a time zone")
        return value


class RouterUnavailable(Exception):
    pass


class RoutingFailure(Exception):
    pass


def station_id(place: dict) -> str | None:
    station = place.get("vehicleRentalStation")
    return station["stationId"].split(":")[-1] if station else None


def normalize(itinerary: dict, request: RouteRequest, stations: dict) -> dict | None:
    legs = []
    previous_end = itinerary["startTime"]
    for leg in itinerary["legs"]:
        legs.append(
            {**leg, "wait_before_seconds": max(0, round((leg["startTime"] - previous_end) / 1000))}
        )
        previous_end = leg["endTime"]
    rental_legs = [leg for leg in legs if leg.get("rentedBike")]
    transit_legs = [leg for leg in legs if leg.get("transitLeg")]
    transit_indices = [i for i, leg in enumerate(legs) if leg.get("transitLeg")]
    connections = []
    for before, after in pairwise(transit_indices):
        if legs[after].get("interlineWithPreviousLeg"):
            continue
        available = round((legs[after]["startTime"] - legs[before]["endTime"]) / 1000)
        connection_walk = round(
            sum(leg["duration"] for leg in legs[before + 1 : after] if leg["mode"] == "WALK")
        )
        connections.append(
            {
                "after_leg_index": before,
                "before_leg_index": after,
                "from": legs[before]["to"]["name"],
                "to": legs[after]["from"]["name"],
                "alight_time": legs[before]["endTime"],
                "board_time": legs[after]["startTime"],
                "available_seconds": available,
                "walk_seconds": connection_walk,
                "wait_seconds": max(0, available - connection_walk),
            }
        )
    walk = sum(leg["duration"] for leg in legs if leg["mode"] == "WALK")
    bike = sum(leg["duration"] for leg in rental_legs)
    if walk > request.max_walk_minutes * 60 or bike > request.max_bike_minutes * 60:
        return None
    warnings = []
    if rental_legs:
        warnings.append("Наличие велосипеда при прибытии не гарантируется.")
        for leg in rental_legs:
            # Bicycle-walking can split a rental into several legs. Check actual rental endpoints.
            for key, pickup in [("from", True), ("to", False)]:
                sid = station_id(leg[key])
                if sid is None:
                    continue
                properties = stations.get(sid)
                if properties and properties["fresh"]:
                    if not properties["installed"]:
                        return None
                    if pickup and (not properties["renting"] or not properties["bikes"]):
                        return None
                    if not pickup and not properties["returning"]:
                        return None
                else:
                    warnings.append(
                        "Наличие и возможность возврата проверь в приложении оператора."
                    )
    start, end = itinerary["startTime"], itinerary["endTime"]
    arrival_seconds = round(end / 1000 - request.departure.timestamp())
    if arrival_seconds < 0:
        return None
    return {
        "kind": "mixed" if rental_legs and transit_legs else "bike" if rental_legs else "transit",
        "start_time": start,
        "end_time": end,
        "duration_seconds": round((end - start) / 1000),
        "total_seconds": arrival_seconds,
        "initial_wait_seconds": max(0, round(start / 1000 - request.departure.timestamp())),
        "walk_seconds": round(walk),
        "bike_seconds": round(bike),
        "transfers": len(connections),
        "connections": connections,
        "waiting_seconds": sum(leg["wait_before_seconds"] for leg in legs),
        "warnings": list(dict.fromkeys(warnings)),
        "legs": legs,
    }


class Router:
    def __init__(self, client: httpx.AsyncClient, url: str):
        self.client = client
        self.url = url
        self.limit = asyncio.Semaphore(2)

    async def query(self, request: RouteRequest, variant: str) -> list[dict]:
        departure = request.departure.astimezone(BERLIN)
        modes = {
            "baseline": {"direct": ["WALK"], "transit": {"access": ["WALK"], "egress": ["WALK"]}},
            "egress": {
                "transitOnly": True,
                "transit": {"access": ["WALK"], "egress": ["WALK", "BICYCLE_RENTAL"]},
            },
            "access": {
                "transitOnly": True,
                "transit": {"access": ["WALK", "BICYCLE_RENTAL"], "egress": ["WALK"]},
            },
            "direct": {"directOnly": True, "direct": ["WALK", "BICYCLE_RENTAL"]},
        }[variant]

        def location(point: Point) -> dict:
            return {"location": {"coordinate": {"latitude": point.lat, "longitude": point.lon}}}

        variables = {
            "from": location(request.origin),
            "to": location(request.destination),
            "departure": departure.isoformat(),
            "modes": modes,
        }
        try:
            async with self.limit:
                response = await self.client.post(
                    self.url, json={"query": QUERY, "variables": variables}, timeout=40
                )
                response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise RouterUnavailable("OpenTripPlanner is not available") from exc
        if payload.get("errors"):
            raise RoutingFailure(str(payload["errors"]))
        plan = payload.get("data", {}).get("planConnection")
        if not plan:
            raise RoutingFailure("Empty OpenTripPlanner response")
        if plan.get("routingErrors") and not plan.get("edges"):
            raise RoutingFailure(str(plan["routingErrors"]))
        return [edge["node"] for edge in plan.get("edges") or []]

    async def plan(self, request: RouteRequest, collection: dict) -> dict:
        results = await asyncio.gather(
            *(
                self.query(request, variant)
                for variant in ["baseline", "egress", "access", "direct"]
            ),
            return_exceptions=True,
        )
        if all(isinstance(result, Exception) for result in results):
            raise results[0]
        stations = {f["properties"]["id"]: f["properties"] for f in collection["features"]}
        warnings = [
            "Транспорт рассчитан по расписанию MVV, без актуальных задержек.",
            "В прототипе проверяются прокат до или после транспорта; велосипед между двумя поездками на транспорте пока не поддержан.",
        ]
        if any(isinstance(result, Exception) for result in results):
            warnings.append("Часть вариантов не удалось рассчитать.")
        routes, seen = [], set()
        for result in results:
            if isinstance(result, Exception):
                continue
            for itinerary in result:
                route = normalize(itinerary, request, stations)
                if not route:
                    continue
                fingerprint = tuple(
                    (
                        leg["mode"],
                        leg["startTime"],
                        leg["endTime"],
                        leg.get("route", {}).get("gtfsId") if leg.get("route") else None,
                        leg["from"]["lat"],
                        leg["from"]["lon"],
                        leg["to"]["lat"],
                        leg["to"]["lon"],
                    )
                    for leg in route["legs"]
                )
                if fingerprint not in seen:
                    seen.add(fingerprint)
                    routes.append(route)
        routes.sort(key=lambda r: (r["total_seconds"], r["transfers"], r["walk_seconds"]))
        baseline = min((r["total_seconds"] for r in routes if r["kind"] == "transit"), default=None)
        for route in routes:
            route["saved_seconds"] = (
                baseline - route["total_seconds"] if baseline is not None else None
            )
        return {"routes": routes, "warnings": warnings, "availability": collection["meta"]}
