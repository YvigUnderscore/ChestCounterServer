# Built from the root of the repository (docker-compose.yml): the image also takes the treasure hunt data
# (content/content.json) and the treasure pictures (assets/treasures) shared with the counter.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data
WORKDIR /srv
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/app ./app
COPY content/content.json ./content/content.json
COPY assets/treasures ./assets/treasures

# Non-root user; the database and the keys live in the /data volume.
RUN useradd --system --uid 10001 chests && mkdir -p /data && chown chests /data
USER chests
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
