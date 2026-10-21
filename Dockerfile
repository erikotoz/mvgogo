FROM python:3.13-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.9.13 /uv /bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY mvgogo ./mvgogo
ENV DATA_DIR=/app/data/cache
RUN useradd --uid 10001 --create-home app && mkdir -p /app/data/cache && chown -R app:app /app/data
USER app
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "mvgogo.main:app", "--host", "0.0.0.0", "--port", "8000"]
