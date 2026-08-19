-- Cross-domain stock transfer audit trail. Products/stocks carry no
-- domain_id of their own (a product's domain is derived from its owning
-- user's users.domain_id, same as everywhere else in this app) — a transfer
-- either reassigns products.user_id (full transfer, quantity == all
-- available stock) or splits off a new product row owned by a user in the
-- destination domain (partial transfer). This table just records what
-- happened, since neither of those operations leaves a trace on its own.
--
-- source_domain_id/destination_domain_id are snapshotted at transfer time
-- rather than derived live, same rationale as lending_order.domain_id
-- (V13): ownership can keep changing after the fact, but the historical
-- record of "which domain sent this to which domain" shouldn't.
--
-- ON DELETE RESTRICT on the domain FKs mirrors lending_order.domain_id: a
-- domain with transfer history can't be deleted out from under it.
CREATE TABLE stock_transfers (
  transfer_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_product_id       UUID        REFERENCES products(product_id) ON DELETE SET NULL,
  destination_product_id  UUID        REFERENCES products(product_id) ON DELETE SET NULL,
  source_domain_id        UUID        NOT NULL REFERENCES coe_domains(domain_id) ON DELETE RESTRICT,
  destination_domain_id   UUID        NOT NULL REFERENCES coe_domains(domain_id) ON DELETE RESTRICT,
  quantity                INTEGER     NOT NULL CHECK (quantity > 0),
  mode                    VARCHAR(10) NOT NULL CHECK (mode IN ('full', 'partial')),
  transferred_by_user_id  UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_transfers_source_product ON stock_transfers(source_product_id);
CREATE INDEX idx_stock_transfers_dest_product ON stock_transfers(destination_product_id);
