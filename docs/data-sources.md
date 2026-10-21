# Data sources

Source inspection date: **21 October 2026**. Snapshot counts and feed dates below
record that inspection; they are not live status claims.

## MyRadl / nextbike

[GBFS auto-discovery](https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ml/gbfs.json)
provides public GBFS 2.3 feeds, including `station_information`, `station_status`,
`free_bike_status` and `vehicle_types`. The inspected snapshot contained 805 stations
and 4,969 bike records, with a 60-second TTL. Counts change over time. The feed's
`system_information` reported CC0-1.0.

Station information includes coordinates, names, operator links and virtual parking
area geometry in `station_area`. Station status contains available bikes by type
and pickup/return flags. Vehicle types distinguish conventional and electric bikes.
The app does not assume per-bike battery data is available.

`free_bike_status` exists, but coordinates do not establish continuous GPS tracking.
A bike record can refer to its station and use station coordinates. The prototype
uses station availability and does not promise precise tracking of every bicycle.

Updates about once per minute are observed feed behaviour, not an uptime guarantee.
On failure, cached locations remain visible and old counts become unknown.
See [nextbike API documentation](https://github.com/nextbike/api-doc).

## MVV

[Official developer information](https://www.mvv-muenchen.de/en/service-support/mvv-content-for-developers/)
provides the [complete GTFS archive](https://www.mvv-muenchen.de/fileadmin/mediapool/developer/opendata/gesamt_gtfs.zip).
The downloaded archive reported `feed_version=20261005`, valid from 1 October to
13 December 2026. It includes regional rail, S-Bahn, U-Bahn, trams and buses.

These are planned schedules (Soll-Fahrplandaten). The archive does not provide
live delays, cancellations or guaranteed connections.

MVV specifies CC BY and requires attribution to **Münchner Verkehrs- und Tarifverbund
GmbH (MVV)** and the retrieval date. Preparation records the date, source URL and
checksum in `data/otp/sources.json`. Keep that manifest with the deployment; the
interface displays its MVV retrieval date.

## OpenStreetMap

Street data comes from the [BBBike Munich extract](https://download.bbbike.org/osm/bbbike/Muenchen/),
using `Muenchen.osm.pbf`, approximately 129 MiB at inspection. Its boundary is smaller
than the full MVV region. Walking/cycling coverage therefore focuses on Munich and
nearby suburbs.

OSM data is © OpenStreetMap contributors under the
[ODbL](https://www.openstreetmap.org/copyright). Map attribution is retained.
Standard OSM tiles are used for modest manual prototyping under the
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
Public scaling, prefetching or offline tiles need a suitable separate arrangement.

## OpenTripPlanner

Version **2.8.1** is pinned. Preparation downloads the JAR from Maven Central and
verifies SHA-256. OTP runs as a separate service under its own license; see
[Third-party notices](../THIRD_PARTY_NOTICES.md).

- [Build and load tutorial](https://docs.opentripplanner.org/en/v2.8.1/Basic-Tutorial/)
- [GBFS configuration](https://docs.opentripplanner.org/en/v2.8.1/GBFS-Config/)
- [System requirements](https://docs.opentripplanner.org/en/v2.8.1/System-Requirements/)

## Photon place search

The prototype uses the public [Photon API](https://photon.komoot.io/api/) with
OpenStreetMap data. See the [API documentation](https://github.com/komoot/photon/blob/master/docs/api-v1.md)
and [demo server terms](https://github.com/komoot/photon#demo-server).

The demo permits reasonable usage without an availability guarantee; high volume
can be blocked. Requests are explicit, throttled and cached, and search is bounded
to Munich. Change `GEOCODER_URL` to use a compatible provider for larger deployments.
Search queries are transmitted to that provider.
