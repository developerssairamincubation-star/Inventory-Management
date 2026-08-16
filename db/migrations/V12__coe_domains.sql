-- COE (Center of Excellence) domains for the coe-inventory rework. A domain
-- IS a COE, 1:1 with a room (enforced by room_name also being unique — a
-- room can't belong to two domains). Referenced by users.domain_id (which
-- COE a user is assigned to) and lending_order.domain_id (which COE a
-- lending entry belongs to), both added in V13.

CREATE TABLE coe_domains (
  domain_id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_name VARCHAR(150) NOT NULL UNIQUE,
  room_name   VARCHAR(150) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
