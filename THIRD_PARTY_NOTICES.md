# Third-party notices

The [MIT license](LICENSE) covers original mvgogo code and documentation. It does not
replace the licenses of third-party software, fonts, map imagery, transport data or
bike-sharing data. Keep the notices below when redistributing the relevant assets.

## Bundled assets

| Component | Version | License | Notice included in this repository |
| --- | --- | --- | --- |
| [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD-2-Clause | [LEAFLET-LICENSE](mvgogo/static/vendor/LEAFLET-LICENSE) |
| [Manrope](https://github.com/sharanda/manrope) | Variable font | SIL Open Font License 1.1 | [OFL.txt](mvgogo/static/fonts/OFL.txt) |

## Separately downloaded software

[OpenTripPlanner 2.8.1](https://github.com/opentripplanner/OpenTripPlanner/tree/v2.8.1)
is a separate Java service, downloaded during data preparation or pulled as a Docker
image. Its [license](https://github.com/opentripplanner/OpenTripPlanner/blob/v2.8.1/LICENSE)
is LGPL-3.0-or-later and includes additional third-party notices. Its source and
license remain available upstream. Python dependencies retain their own licenses;
the resolved versions are recorded in `uv.lock`. These dependencies and the OTP JAR
are not checked into this repository.

## Data and services

| Source | Attribution and terms |
| --- | --- |
| OpenStreetMap data | © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright) |
| OpenStreetMap standard map tiles | © OpenStreetMap contributors; see the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and [tile licensing](https://www.openstreetmap.org/copyright) |
| MVV GTFS | Münchner Verkehrs- und Tarifverbund GmbH (MVV), CC BY as stated on the [developer page](https://www.mvv-muenchen.de/en/service-support/mvv-content-for-developers/); include the retrieval date |
| MyRadl / nextbike GBFS | CC0-1.0 as reported by the feed's `system_information` on 21 October 2026; see [data sources](docs/data-sources.md) |
| Photon geocoding | Results use OpenStreetMap data; the public demo has separate [usage conditions](https://github.com/komoot/photon#demo-server) |

Downloaded datasets, cached feeds and generated routing graphs are excluded from
Git. `data/otp/sources.json` records the source URL, retrieval date and SHA-256 of
each downloaded input. The application displays the MVV retrieval date from that
manifest and preserves map attribution. README screenshots include map imagery;
the OpenStreetMap attribution applies to that imagery too. Screenshot availability
counts and schedules are historical examples, not current travel information.

mvgogo is an independent project. MVG, MVV, MyRadl and nextbike names belong to their
respective owners; this project is not an official product of those organisations.
