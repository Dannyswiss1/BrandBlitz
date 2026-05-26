ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS product_image_urls TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS product_image_1_url TEXT,
  ADD COLUMN IF NOT EXISTS product_image_2_url TEXT;

UPDATE brands
SET product_image_urls = '{}'
WHERE product_image_urls IS NULL;

ALTER TABLE brands
  ALTER COLUMN product_image_urls SET DEFAULT '{}',
  ALTER COLUMN product_image_urls SET NOT NULL;

ALTER TABLE brands
  DROP COLUMN IF EXISTS product_image_keys;
