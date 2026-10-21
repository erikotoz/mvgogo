"""Inspect live MyRadl feeds without assuming precise vehicle GPS locations."""

import asyncio
import json
from datetime import datetime, timezone

import httpx


async def main():
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        response = await client.get("https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ml/gbfs.json")
        response.raise_for_status()
        discovery = response.json()
        urls = {f["name"]: f["url"] for f in discovery["data"]["en"]["feeds"]}
        output = {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "version": discovery["version"],
        }
        for name, key in [
            ("station_information", "stations"),
            ("station_status", "stations"),
            ("free_bike_status", "bikes"),
        ]:
            response = await client.get(urls[name])
            response.raise_for_status()
            payload = response.json()
            rows = payload["data"][key]
            output[name] = {
                "url": urls[name],
                "count": len(rows),
                "ttl": payload["ttl"],
                "updated_at": datetime.fromtimestamp(
                    payload["last_updated"], timezone.utc
                ).isoformat(),
            }
            if key == "bikes":
                output[name]["station_associated"] = sum(
                    bool(row.get("station_id")) for row in rows
                )
                output[name]["available_records"] = sum(
                    not row["is_reserved"] and not row["is_disabled"] for row in rows
                )
        print(json.dumps(output, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
