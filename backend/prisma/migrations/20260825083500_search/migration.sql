-- Full-text + fuzzy search (PRD §28, §75, §76)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Weighted search vector for resources: title (A) > short desc (B) > full desc/requirements (C)
ALTER TABLE "Resource" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("shortDescription", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("fullDescription", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("requirements", '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS "Resource_searchVector_idx" ON "Resource" USING GIN ("searchVector");
CREATE INDEX IF NOT EXISTS "Resource_title_trgm_idx" ON "Resource" USING GIN ("title" gin_trgm_ops);

ALTER TABLE "Tutorial" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("body", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "Tutorial_searchVector_idx" ON "Tutorial" USING GIN ("searchVector");
CREATE INDEX IF NOT EXISTS "Tutorial_title_trgm_idx" ON "Tutorial" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Tag_name_trgm_idx" ON "Tag" USING GIN ("name" gin_trgm_ops);
