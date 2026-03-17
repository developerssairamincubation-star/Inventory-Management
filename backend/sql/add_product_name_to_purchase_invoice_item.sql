ALTER TABLE public.purchase_invoice_item
ADD COLUMN IF NOT EXISTS product_name TEXT;

ALTER TABLE public.purchase_invoice_item
ALTER COLUMN product_id DROP NOT NULL;