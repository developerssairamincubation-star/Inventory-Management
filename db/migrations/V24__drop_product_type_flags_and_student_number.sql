-- products.returnable/consumable are dead weight now that lending_item.item_type
-- (db/migrations/V15) is the sole source of truth for whether a given lend is
-- returnable or consumable — chosen per line item at lending time, not fixed
-- per product. Keeping the product-level flags around just let the two get
-- out of sync and confused admins editing the product form.
--
-- students.student_number (legacy free-text field, superseded by
-- student_id_code in db/migrations/V14) is unused elsewhere and just adds a
-- confusing second "ID" field on the student form.

ALTER TABLE products DROP COLUMN returnable;
ALTER TABLE products DROP COLUMN consumable;
ALTER TABLE students DROP COLUMN student_number;
