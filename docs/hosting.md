# Hosting and resources

## Starting configuration

For personal use with the current Munich routing graph, start with **2–4 vCPU,
8 GB RAM and 20 GB SSD**, on Linux. No GPU is needed. This is an estimate, not a
measured minimum for every provider.

| Workload | Starting point | Notes |
| --- | --- | --- |
| Station map only | 1 vCPU, 512 MB–1 GB RAM | No OTP or route calculation |
| Personal use with OTP | 2–4 vCPU, 8 GB RAM | 4 GB OTP heap, plus native memory and OS headroom |
| Several concurrent users | 4 vCPU, 8–16 GB RAM | Requires load testing and request limits |
| Graph building on a separate machine | 4+ vCPU, 12–16 GB RAM | Initial Java heap setting: `-Xmx8G` |

A small graph file does not imply low RAM use. `-Xmx4G` limits only the Java heap,
not the process's total memory. Compose allows 6 GB for OTP and 512 MB for the web
container, leaving the rest for the OS and filesystem cache on an 8 GB host. Do not
set the container memory limit equal to its heap size.

Graph memory depends on the street area, network density, schedule window and
elevation data. Single-core speed affects individual search latency; additional
cores help concurrent requests. Shared vCPU performance varies by host.
See [OTP system requirements](https://docs.opentripplanner.org/en/v2.8.1/System-Requirements/).

## Build separately, serve continuously

Build the graph on a laptop or temporary larger machine and upload it to the
serving host. Keep the OTP version and configuration consistent. Serving needs the
finished `graph.obj`; OSM/GTFS downloads are needed for rebuilding, not each request.
See [OTP build and load workflow](https://docs.opentripplanner.org/en/v2.8.1/Basic-Tutorial/).

Schedule updates require a rebuild. Bike availability updates do not. Hundreds
of station records are a small JSON workload and do not justify a larger server
on their own.

## Local measurements — 21 October 2026

Test machine: 48 GB RAM, 14 processors available to Java, OTP 2.8.1 JAR.

| Measurement | Observation |
| --- | --- |
| Input data | 135.4 MB OSM + 17.9 MB MVV GTFS |
| Graph | 848,915 vertices; 2,111,188 edges; 18,861 transit stops |
| Build with `-Xmx8G` | 1 min 41 sec, plus about 4 sec to save |
| Saved graph | 228.2 MB, approximately 218 MiB |
| OTP RSS after initial queries, with `-Xmx4G` | About 2.36 GiB |
| Heap used at that observation | About 1.56 GiB |
| Five sequential warmed route comparisons | About 0.44–0.61 sec each, including four OTP searches |

This was a short smoke test on a powerful laptop. It is not a VPS load test or a
peak-memory measurement. Departure time, candidate routes, bike availability and
hardware affect results. An observed time saving on one trip is not a general
performance or routing claim.

## Before public deployment

- Put FastAPI behind an HTTPS reverse proxy. Keep OTP private.
- Limit expensive `/api/routes` requests, concurrency and queue length.
- Preserve the station cache directory on persistent storage.
- Choose map tile and geocoding services appropriate to the expected public load.
  Respect the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
  and [Photon demo terms](https://github.com/komoot/photon#demo-server).
- Rotate logs and avoid retaining personal addresses in access logs unnecessarily.
- Schedule GTFS/OSM refreshes and rebuild before the graph's service period expires.
- Test the actual Docker deployment; local verification used Uvicorn and the JAR.

A persistent VPS suits OTP's loaded graph better than short-lived functions with
cold starts. A domain and HTTPS make the browser app reachable from a phone;
installation as a PWA is still a planned feature.

## What to measure on the host

Check OTP RSS after loading and repeated queries, heap/GC behaviour, first-request
latency and warmed median/p95 latency. Test two and four simultaneous route
comparisons, then choose request limits based on those results. Measure rebuild
peak memory separately from normal serving.
