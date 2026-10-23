# Native Ubuntu deployment

The templates in `deploy/` run mvgogo as two unprivileged systemd services behind
nginx. Only nginx listens publicly. FastAPI and OTP bind to loopback on ports 8000
and 8080. The nginx template limits expensive route requests to one active request
across the site, with additional request-rate limits. This profile is intended for
personal use, not a public high-traffic service.

## Prepare the host and files

Use Ubuntu 24.04 with Python 3.12 and Java 21. The normal recommendation remains
8 GB RAM; graph building should happen on a larger machine.

```sh
sudo apt-get update
sudo apt-get install -y --no-install-recommends python3-venv openjdk-21-jre-headless nginx certbot python3-certbot-nginx
sudo useradd --system --user-group --home-dir /var/lib/mvgogo --no-create-home --shell /usr/sbin/nologin mvgogo
sudo install -d -m 0750 -o mvgogo -g mvgogo /var/lib/mvgogo
```

Place the committed project source at `/opt/mvgogo`, without credentials or a
personal `.env`. Copy the prepared runtime files from the build machine:

```text
/opt/mvgogo/data/tools/otp.jar
/opt/mvgogo/data/otp/graph.obj
/opt/mvgogo/data/otp/sources.json
/opt/mvgogo/data/otp/router-config.json
```

Use the same OTP version and routing configuration as the graph build. Compare
SHA-256 on both machines after transfer. Do not rebuild the graph on a 2 GB host.

Export production dependencies from the lockfile on the development machine:

```sh
uv export --frozen --no-dev --no-emit-project --output-file data/deploy-requirements.txt
```

Copy that file to `/opt/mvgogo/requirements-deploy.txt`, then install on the host:

```sh
sudo python3 -m venv /opt/mvgogo/.venv
sudo /opt/mvgogo/.venv/bin/pip install --require-hashes -r /opt/mvgogo/requirements-deploy.txt
sudo install -m 0644 /opt/mvgogo/deploy/systemd/mvgogo-web.service /etc/systemd/system/
sudo install -m 0644 /opt/mvgogo/deploy/systemd/mvgogo-otp.service /etc/systemd/system/
```

The services read optional overrides from `/etc/mvgogo.env`. Keep the source tree
owned by root; the web service writes its station cache only under
`/var/lib/mvgogo/cache`. Access logs are disabled in both Uvicorn and the nginx
template to avoid routinely retaining searched addresses.

## HTTPS

Choose a hostname whose DNS points to the host and allow inbound TCP ports 80 and
443. Replace `mvgogo.example.com` in `deploy/nginx.conf` with that hostname, install
it in `/etc/nginx/sites-available/mvgogo` and symlink it into `sites-enabled`.
Disable Ubuntu's default welcome site if it is unused. Validate before reloading:

```sh
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d YOUR_HOSTNAME --redirect
```

Certbot adds HTTPS, the redirect and certificate renewal. Verify its renewal timer
and keep nginx running for future validation. A temporary `sslip.io` hostname can
be used without buying a domain, but it depends on an external DNS service. A
permanent deployment should use a hostname you control.

## Start and verify

```sh
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/mvgogo-web.service /etc/systemd/system/mvgogo-otp.service
sudo systemctl enable --now mvgogo-web mvgogo-otp
sudo systemctl status mvgogo-web mvgogo-otp
sudo journalctl -u mvgogo-otp -n 40 --no-pager
```

The web health check confirms the web process, not routing readiness. Wait for OTP
to load its graph and refresh rental stations, then verify `/api/stations`, place
search and a real `/api/routes` request through HTTPS. Check `NRestarts` and memory
after queries. Test Plan/Map navigation in a mobile browser viewport.

## Experimental 2 GB profile

On 23 October 2026, the existing Munich graph loaded on a 1-vCPU / 2-GB VPS with
1 GB swap, using a **1152 MB heap** and Serial GC. This is a constrained personal
deployment, not a replacement for the normal 8 GB recommendation. Other heavy
workloads must be stopped. The first external route comparison took about 12
seconds; live stations, geocoding and mixed routes returned successfully.

For that profile, `/etc/mvgogo.env` contains:

```ini
OTP_HEAP=1152M
```

The OTP service also uses a systemd drop-in at
`/etc/systemd/system/mvgogo-otp.service.d/memory.conf`:

```ini
[Service]
MemoryHigh=1500M
MemoryMax=1700M
MemorySwapMax=512M
```

These values constrain this graph and workload. Watch memory pressure, latency and
service restarts. Keep the proxy's single-route limit. Larger graphs or concurrent
use need a larger host; increasing swap alone does not provide predictable routing
performance. Do not run the default Docker memory profile on this small VPS.

## Updates and stopping

Build updated graphs elsewhere, stop OTP before replacing `graph.obj`, transfer
the accompanying manifest/configuration, then restart and test. Do not overwrite
a graph while it is being loaded. Rebuild before the GTFS/service window expires.

```sh
sudo systemctl restart mvgogo-web
sudo systemctl restart mvgogo-otp
sudo systemctl disable --now mvgogo-web mvgogo-otp
```

The last command pauses the application across reboots and preserves data. Enable
the services again to resume. On a 2 GB host, stop them before resuming another
memory-intensive workload.
