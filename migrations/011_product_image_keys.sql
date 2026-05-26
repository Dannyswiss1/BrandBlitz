ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS product_image_keys TEXT[] NOT NULL DEFAULT '{}';

UPDATE brands
SET product_image_keys = '{}'
WHERE product_image_keys IS NULL;

ALTER TABLE brands
  ALTER COLUMN product_image_keys SET DEFAULT '{}',
  ALTER COLUMN product_image_keys SET NOT NULL;

ALTER TABLE brands
  DROP COLUMN IF EXISTS product_image_urls,
  DROP COLUMN IF EXISTS product_image_1_url,
  DROP COLUMN IF EXISTS product_image_2_url;
