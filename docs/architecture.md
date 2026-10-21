# Architecture

## Data flow

FastAPI serves the browser interface and API from one origin. The browser requests
stations from the API; the server combines GBFS discovery, station information,
station status and vehicle types into one snapshot, cached for a minute. The last
snapshot is also saved to disk.

Retrieval time never replaces source time. Both the feed's `last_updated` and each
station's `last_reported` are checked. Failed or stale updates make availability
and rental/return permissions unknown. The browser checks age again between
refreshes, so counts cannot remain apparently current just because a tab is open.

For routing, the browser sends coordinates, a timezone-aware departure and
walking/cycling limits. FastAPI issues four OTP GraphQL `planConnection` searches:

| Scenario | Search |
| --- | --- |
| Baseline | Walking and public transport |
| Bike after transit | Transit with rental on egress |
| Bike before transit | Rental on access to transit |
| Direct rental | Walking and bike rental without transit |

At most two requests reach OTP concurrently. Rental searches also include `WALK`,
as required by the observed OTP 2.8.1 behaviour. They can return non-bike results.
Separate scenarios prevent direct cycling from crowding out every mixed candidate.

OTP searches OSM streets and GTFS schedules, with its own GBFS updates. The API
checks rental stations against its station snapshot, rejects known empty or closed
pickup points and closed return points, deduplicates, filters and sorts by arrival.
The API and OTP snapshots can differ in age; neither reserves a bike.

## Search boundaries

The prototype supports rental on access to transit and on egress from transit.
It does not separately search for a bike ride between two transit journeys.
The search uses a bounded result count and search window. It is not an exhaustive
search or a guarantee of the globally fastest route.

Walking and cycling limits filter returned candidates. If every returned candidate
fails a limit, that does not prove there is no valid route outside the candidate
set. Extending the search requires evaluating OTP's transfer modes or explicitly
joining searches with compatible arrival/departure times.

## Timing and transfers

| Result field | Meaning |
| --- | --- |
| `total_seconds` | Requested departure to arrival, including initial waiting |
| `duration_seconds` | Actual itinerary start to arrival |
| `initial_wait_seconds` | Requested departure to actual itinerary start |
| `waiting_seconds` | Waiting between legs, excluding initial waiting |
| `legs[].wait_before_seconds` | Gap between the previous leg's end and this leg's start |
| `connections` | Alighting/boarding times, walking and remaining wait for each transit connection |

Results also include walking/cycling totals, transfers, geometry and warnings.
Transfers follow the GTFS timetable, so the next boarding time includes the wait
after the connecting walk. `transferSlack: 2m` is configured in OTP and is not added
again to the final result. `interlineWithPreviousLeg` continuations in the same
vehicle do not count as transfers.

Rental pickup (90 seconds) and return (45 seconds) allowances are configured inside
OTP so they affect which connections can be reached. Transit remains schedule-based;
there are no live delays or cancellations.

## MyRadl stations

Station import includes virtual parking areas. `rentalPickupTypes: ["station"]`
avoids duplicating stations as individual bicycle vertices. This scenario does not
need precise coordinates of every bike.

A virtual station reporting `num_docks_available = 0` does not necessarily prohibit
returns. OTP uses `overloadingAllowed: true`; the API separately checks fresh
`is_installed` and `is_returning` flags. The map can show the `station_area` polygon.
The app plans station returns, not arbitrary parking at a destination address.

Unknown availability is never invented. An existing OTP result can require manual
verification. A GBFS outage does not guarantee OTP can find new rental routes,
even though the cached station map remains usable.

## Places and presentation

Place search is separate from routing. FastAPI forwards explicit searches to
Photon, restricted to Munich and nearby suburbs, with about one upstream request
per second per process. An in-memory LRU cache holds up to 256 searches for 24 hours.
The provider URL is configurable. The application does not write address searches
to disk, but HTTP access logs can contain queries in request URLs.

Home and Work use browser localStorage. Selecting a saved place needs no new
geocoding request. Storage failures are reported, and the save dialog supports
replacement and deletion.

Stations cluster by a screen grid at lower zoom levels. Individual stations use
contrasting count markers. During route calculation, station selection and route
viewing, background stations fade while relevant stations keep their emphasis.
The All stations checkbox can hide background stations entirely. An open station
card survives data refreshes. Matching leg colours and numbered steps connect the
map to boarding, alighting and waiting times.

## Mobile layout

Below 821 px, Plan and Map switch without reloading. The hidden view receives
`inert` so keyboard focus stays in the visible view. Opening the map invalidates
Leaflet's size. The station bottom sheet sits outside Leaflet's transformed panes
to avoid positioning errors. The layout uses `100dvh`, safe-area insets, reduced
motion preferences and locally hosted Manrope under the OFL.

## Deployment model

The frontend needs no separate build. Leaflet is bundled with its license; the
browser loads map tiles directly from the configured tile URL. OTP keeps its graph
in RAM. There is no database, Redis, message broker or tile server.

One Uvicorn process preserves a single in-memory cache and OTP concurrency limit.
A public deployment needs HTTPS, upstream timeouts and request/queue limits at the
reverse proxy. See [Hosting](hosting.md).
