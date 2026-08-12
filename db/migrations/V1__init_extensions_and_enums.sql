-- Extensions and enum types shared across the schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE borrower_type_enum AS ENUM (
  'STUDENT',
  'STAFF'
);

CREATE TYPE lending_item_status AS ENUM (
  'ISSUED',
  'RETURNED',
  'OVERDUE',
  'LOST',
  'NON_RETURNABLE_GIVEN'
);

CREATE TYPE lending_order_status AS ENUM (
  'PENDING',
  'RETURNED',
  'CONSUMABLE',
  'PARTIALLY_RETURNED',
  'PARTIALLY_DAMAGED',
  'PARTIALLY_LOST',
  'RETURNED_DAMAGED',
  'RETURNED_LOST',
  'DAMAGED',
  'LOST'
);
