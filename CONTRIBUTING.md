# Contributing

Thanks for helping make Munich trips easier. Small fixes, reproducible routing
reports and improvements to mobile usability are all welcome.

## Set up

Follow [Getting started](docs/getting-started.md). Python-only checks do not require
Java, an OTP graph, network access or API credentials:

```sh
uv sync --frozen --group dev
make test check
```

The frontend is plain JavaScript and CSS, served by FastAPI. There is no Node.js
build step. Use English for code, comments, documentation and interface copy. Keep
upstream place names and required data attributions in their original form.

## Make a change

1. Create a branch with a short, descriptive name.
2. Keep the change focused and explain the user-visible result.
3. Run `make test check`. Add regression coverage when changing routing, freshness
   rules, input validation or upstream failure handling.
4. For interface changes, check both a desktop viewport and a 360–390 px mobile
   viewport. Exercise Plan/Map navigation, station cards and route steps.
5. Open a pull request with the problem, the change and the checks you ran. Include
   screenshots when the interface changes.

Do not commit `.env`, personal Home/Work locations, downloaded feeds, routing
graphs, caches or logs. Use public landmarks in examples. Preserve all attribution
and third-party license files.

## Report a routing issue

Include public start/end points, a departure timestamp **with its timezone**, the
walking/cycling limits, the result you received and the result you expected. Note
whether the problem concerns a planned schedule or current bike availability.
Remove private addresses and personal saved places from screenshots and logs.

## Data changes

Keep source URLs and terms documented in [Data sources](docs/data-sources.md).
Unknown availability must remain unknown; never substitute zero or stale counts.
Transfer and rental allowances must affect the search itself, rather than being
added to the final duration after planning.

Contributions to original project code are made under the [MIT license](LICENSE).
