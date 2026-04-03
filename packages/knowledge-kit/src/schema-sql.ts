export const KNOWLEDGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS kb_raw_documents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source_url TEXT,
  source_created_at TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  compiled INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_id)
);

CREATE TABLE IF NOT EXISTS kb_articles (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  source_doc_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  compiled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kb_entities (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  article_slug TEXT NOT NULL REFERENCES kb_articles(slug) ON DELETE CASCADE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_entities_type ON kb_entities(type);
CREATE INDEX IF NOT EXISTS idx_kb_entities_article ON kb_entities(article_slug);

CREATE TABLE IF NOT EXISTS kb_index (
  article_slug TEXT PRIMARY KEY REFERENCES kb_articles(slug) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
