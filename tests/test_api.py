from fastapi.testclient import TestClient

from mvgogo.config import Settings
from mvgogo.gbfs import FeedUnavailable
from mvgogo.geocoding import GeocoderUnavailable
from mvgogo.main import create_app
from mvgogo.routing import RouterUnavailable


class OfflineFeed:
    async def stations(self):
        raise FeedUnavailable()


class OfflineRouter:
    async def plan(self, *args):
        raise RouterUnavailable()


def test_web_and_independent_outage_handling(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        client.app.state.gbfs = OfflineFeed()
        client.app.state.router = OfflineRouter()
        assert client.get("/healthz").status_code == 200
        assert "mvgogo" in client.get("/").text
        assert client.get("/static/app.js").status_code == 200
        assert client.get("/api/stations").status_code == 503
        response = client.post(
            "/api/routes",
            json={
                "origin": {"lat": 48.1, "lon": 11.5},
                "destination": {"lat": 48.2, "lon": 11.6},
            },
        )
        assert response.status_code == 503
        assert "router" in response.json()["detail"]


def test_api_rejects_invalid_inputs(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        response = client.post(
            "/api/routes",
            json={
                "origin": {"lat": 48.1, "lon": 11.5},
                "destination": {"lat": 48.2, "lon": 11.6},
                "departure": "2026-10-21T12:00:00",
                "max_bike_minutes": 0,
            },
        )
        assert response.status_code == 422


def test_place_search_validation_and_outage(tmp_path):
    class OfflineGeocoder:
        async def search(self, query):
            raise GeocoderUnavailable()

    with TestClient(create_app(Settings(data_dir=tmp_path))) as client:
        client.app.state.geocoder = OfflineGeocoder()
        assert client.get("/api/places", params={"q": "  "}).status_code == 422
        assert client.get("/api/places", params={"q": "M"}).status_code == 422
        response = client.get("/api/places", params={"q": "Marienplatz"})
        assert response.status_code == 503
        assert "on the map" in response.json()["detail"]
