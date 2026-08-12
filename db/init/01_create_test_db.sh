#!/bin/sh
# Runs once, only against a fresh postgres data volume (official postgres
# image convention: everything under docker-entrypoint-initdb.d/ executes on
# first init). Creates a second database for the Vitest integration suite so
# tests never run against the dev database's data.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE ${POSTGRES_TEST_DB:-inventory_test};"
