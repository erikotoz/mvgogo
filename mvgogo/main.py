import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from mvgogo.config import Settings
from mvgogo.gbfs import FeedUnavailable, Gbfs
from mvgogo.geocoding import Geocoder, GeocoderUnavailable
from mvgogo.routing import Router, RouteRequest, RouterUnavailable, RoutingFailure

STATIC = Path(__file__).parent / "static"
log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(
            timeout=12, follow_redirects=True, headers={"User-Agent": "mvgogo/0.1"}
        ) as client:
            app.state.gbfs = Gbfs(client, settings)
            app.state.router = Router(client, settings.otp_url)
            app.state.geocoder = Geocoder(client, settings.geocoder_url)
            yield

    app = FastAPI(title="mvgogo", lifespan=lifespan)

    @app.get("/healthz")
    async def health():
        return {"status": "ok"}

    @app.get("/api/sources")
    async def sources():
        try:
            manifest = json.loads(settings.source_manifest.read_text())
            return {"mvv_retrieved_at": manifest.get("mvv.gtfs.zip", {}).get("retrieved_at")}
        except (OSError, ValueError, AttributeError):
            return {"mvv_retrieved_at": None}

    @app.get("/api/stations")
    async def stations(request: Request):
        try:
            return await request.app.state.gbfs.stations()
        except FeedUnavailable as exc:
            raise HTTPException(
                503, "Stations are unavailable. Try refreshing in a minute."
            ) from exc

    @app.get("/api/places")
    async def places(request: Request, q: str = Query(min_length=2, max_length=160)):
        query = q.strip()
        if len(query) < 2:
            raise HTTPException(422, "Enter at least two characters.")
        try:
            return {"results": await request.app.state.geocoder.search(query)}
        except GeocoderUnavailable as exc:
            raise HTTPException(
                503, "Address search is unavailable. Pick a point on the map."
            ) from exc

    @app.post("/api/routes")
    async def routes(body: RouteRequest, request: Request):
        try:
            collection = await request.app.state.gbfs.stations()
        except FeedUnavailable:
            collection = {"features": [], "meta": {"mode": "stations_only"}}
        try:
            return await request.app.state.router.plan(body, collection)
        except RouterUnavailable as exc:
            raise HTTPException(
                503, "The router is not running yet. The station map is available."
            ) from exc
        except RoutingFailure as exc:
            log.warning("Routing failed: %s", exc)
            raise HTTPException(
                502, "Could not plan a route. Check your points and departure date."
            ) from exc

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


app = create_app()
