-- Free-text storage location (e.g. "R2", "L3") for a product's stock.
-- Entered per invoice line item when restocking via Upload Invoice; one
-- location per product (like quantity) — overwritten by whichever invoice
-- restocks it most recently.
ALTER TABLE stocks ADD COLUMN location VARCHAR(50);
