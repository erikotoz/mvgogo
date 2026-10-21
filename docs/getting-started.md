# Getting started

## Requirements

- Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/).
  Python 3.13 is used in CI and the Docker image.
- Java 21+ for local routing. Java is not needed for the station map or tests.
- `make`, an internet connection and enough memory to build a routing graph.

No Google API key, bike-sharing account, database or Node.js installation is needed.
The default public feeds and geocoder require no credentials.

## Local setup

```sh
git clone https://github.com/erikotoz/mvgogo.git
cd mvgogo
make install
make prepare
make graph
```

The first preparation downloads roughly 320 MB of streets, schedules and the
OpenTripPlanner JAR. The JAR version and SHA-256 are pinned in `scripts/prepare.py`.
Large files stay under the ignored `data/` directory.

Graph building defaults to an 8 GB Java heap, with additional memory needed by the
JVM and OS. A machine with 12–16 GB RAM is a useful starting point. The limit can
be changed, but smaller heaps are not guaranteed to build this dataset:

```sh
make graph BUILD_HEAP=6G
```

Start the router:

```sh
make router
```

In a separate terminal, start the web application:

```sh
make dev
```

Open [localhost:8000](http://localhost:8000). Allow roughly a minute for the first
GBFS station update in OTP. Choose **Try an example**, then **Find a route**.
The example uses public points at Münchner Freiheit and Westpark.

For the station map alone, `make install` and `make dev` are sufficient. Route
requests return a clear error while OTP is unavailable.

## Configuration

The application reads process environment variables. It does **not** automatically
load `.env`; `.env.example` is a reference for the supported settings.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GBFS_URL` | MyRadl / nextbike GBFS discovery URL | Station and availability source |
| `OTP_URL` | `http://127.0.0.1:8080/otp/gtfs/v1` | OTP GraphQL endpoint |
| `DATA_DIR` | `data/cache` | Persistent station snapshot directory |
| `AVAILABILITY_MAX_AGE` | `180` | Maximum status age, in seconds |
| `SOURCE_MANIFEST` | `data/otp/sources.json` | Download metadata and MVV retrieval date |
| `GEOCODER_URL` | `https://photon.komoot.io/api/` | Compatible Photon search endpoint |

For example:

```sh
OTP_URL=http://127.0.0.1:8080/otp/gtfs/v1 make dev
```

Preserve `DATA_DIR` across server restarts so cached station locations can be used
when the feed is unavailable. Stale counts and rental/return permissions are shown
as unknown, not reused as current availability.

## Docker Compose

Install Docker with Compose. Data preparation uses the host Python environment;
Compose builds the graph and runs the application services:

```sh
make install
make prepare
docker compose --profile build run --rm graph
docker compose up --build -d web otp
```

Compose exposes only `127.0.0.1:8000` on the host. OTP is accessible inside the
Compose network. Images use OTP 2.8.1, and graph building is separate from serving.
You can build `graph.obj` on another computer and copy it to `data/otp/`, keeping
the OTP version and configuration consistent.

Local end-to-end verification used the JAR and Uvicorn. Validate the Docker setup
on the intended host before relying on it for deployment.

## Refresh the routing data

```sh
make refresh
make graph
```

Stop OTP before replacing its active graph, then start it again. Graph builds use
a service window from one week in the past to eight weeks in the future; the GTFS
archive also has its own validity period. Refresh and rebuild before that coverage
expires. A fresh download does not necessarily mean the publisher has released a
new feed.

GBFS availability refreshes automatically about once per minute and does not need
a graph rebuild. The source manifest records URLs, retrieval dates and checksums.

## Development checks

```sh
make test check
```

These tests use mocked upstream services and do not need a graph or network.
For an optional live feed inspection:

```sh
.venv/bin/python scripts/probe.py
```

## On a phone

At widths of 820 px or less, **Plan** and **Map** switch between full-screen views.
Station details appear in a bottom sheet. **Start here / End here** returns to the
planner; route steps and **View full route on map** open the map.

The app is currently a browser application. It does not yet include an installable
PWA, APK or offline routing. `localhost` on a phone refers to the phone itself, so
a phone needs a reachable server URL. The default development server and Compose
port deliberately bind to the computer's loopback interface.

Home and Work are saved in that browser's localStorage. They are not synced across
devices, and clearing browser data removes them. Address searches are sent to
Photon only after pressing **Find** or Enter. Server access logs may contain search
queries in request URLs; account for that when deploying.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Map works, routes fail | Start `make router`; check `OTP_URL` and that `graph.obj` exists. |
| No bike routes immediately after startup | Wait for OTP's first GBFS refresh and check source availability. |
| Station counts show `?` | Source timestamps may be stale or the feed unavailable. Refresh; verify in the operator app. |
| No routes for a future date | Check GTFS validity and rebuild the graph with current data. |
| Graph build runs out of memory | Use more RAM or build on another machine. Changing heap alone cannot add physical memory. |
| Address search fails | Try coordinates or a map point; check the configured Photon provider. |
| Phone cannot reach the app | Use a reachable HTTPS deployment; the default loopback address is local to the host. |

See [Hosting](hosting.md) before exposing the app publicly.
