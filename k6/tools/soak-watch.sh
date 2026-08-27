#!/bin/sh
# Samples the things a soak is meant to catch but k6 cannot see, once a minute:
#   rss_mb   - Node heap+native growth. A steady climb that never plateaus is a leak.
#   pg_conns - open Postgres backends. Should sit at PGPOOL_MAX, not creep past it.
#   pg_idle_tx - connections stuck "idle in transaction": a transaction leak, which
#                holds locks and blocks autovacuum. Should always be 0.
# Written as CSV so it can be plotted or diffed against the k6 timeline afterwards.
OUT="${1:-soak-watch.csv}"
echo "ts,rss_mb,pg_conns,pg_idle_tx" > "$OUT"
while true; do
  RSS=$(ps -Ao rss,command | grep '[n]ext-server' | head -1 | awk '{printf "%.0f", $1/1024}')
  CONNS=$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" inventory-management-postgres-1 \
    psql -U "$POSTGRES_USER" -d inventory -t -A -c \
    "select count(*) from pg_stat_activity where datname='inventory';" 2>/dev/null)
  IDLETX=$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" inventory-management-postgres-1 \
    psql -U "$POSTGRES_USER" -d inventory -t -A -c \
    "select count(*) from pg_stat_activity where datname='inventory' and state='idle in transaction';" 2>/dev/null)
  echo "$(date +%H:%M:%S),${RSS:-0},${CONNS:-0},${IDLETX:-0}" >> "$OUT"
  sleep 60
done
