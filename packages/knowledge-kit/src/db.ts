import type Database from 'better-sqlite3'
import { KNOWLEDGE_SCHEMA } from './schema-sql.js'
import type {
  RawDocument,
  StoredRawDocument,
  Article,
  Entity,
  IndexEntry,
  EntityListOptions,
  KBStats,
} from './types.js'

// ── Schema ───────────────────────────────────────────────────────

export function initSchema(db: Database.Database): void {
  db.exec(KNOWLEDGE_SCHEMA)
}

// ── Raw Documents ────────────────────────────────────────────────

export function insertRawDocument(db: Database.Database, doc: RawDocument): void {
  db.prepare(`
    INSERT INTO kb_raw_documents (source_id, source_type, title, content, metadata_json, source_url, source_created_at, compiled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(source_id) DO UPDATE SET
      content = excluded.content,
      title = excluded.title,
      metadata_json = excluded.metadata_json,
      source_url = excluded.source_url,
      source_created_at = excluded.source_created_at,
      compiled = 0
  `).run(
    doc.sourceId,
    doc.sourceType,
    doc.title ?? null,
    doc.content,
    JSON.stringify(doc.metadata ?? {}),
    doc.sourceUrl ?? null,
    doc.createdAt ?? null,
  )
}

export function getRawDocument(db: Database.Database, sourceId: string): StoredRawDocument | null {
  const row = db.prepare('SELECT * FROM kb_raw_documents WHERE source_id = ?').get(sourceId) as any
  if (!row) return null
  return rowToRawDocument(row)
}

export function getUncompiledDocuments(db: Database.Database): StoredRawDocument[] {
  const rows = db.prepare('SELECT * FROM kb_raw_documents WHERE compiled = 0').all() as any[]
  return rows.map(rowToRawDocument)
}

export function getRawDocumentsByIds(db: Database.Database, sourceIds: string[]): StoredRawDocument[] {
  if (sourceIds.length === 0) return []
  const placeholders = sourceIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM kb_raw_documents WHERE source_id IN (${placeholders})`).all(...sourceIds) as any[]
  return rows.map(rowToRawDocument)
}

export function markDocumentsCompiled(db: Database.Database, sourceIds: string[]): void {
  if (sourceIds.length === 0) return
  const placeholders = sourceIds.map(() => '?').join(',')
  db.prepare(`UPDATE kb_raw_documents SET compiled = 1 WHERE source_id IN (${placeholders})`).run(...sourceIds)
}

function rowToRawDocument(row: any): StoredRawDocument {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceType: row.source_type,
    title: row.title,
    content: row.content,
    metadata: JSON.parse(row.metadata_json),
    metadataJson: row.metadata_json,
    sourceUrl: row.source_url,
    createdAt: row.source_created_at,
    ingestedAt: row.ingested_at,
    compiled: row.compiled === 1,
  }
}

// ── Articles ─────────────────────────────────────────────────────

interface UpsertArticleInput {
  slug: string
  title: string
  content: string
  frontmatter: Record<string, unknown>
  sourceDocIds: string[]
}

export function upsertArticle(db: Database.Database, article: UpsertArticleInput): void {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO kb_articles (slug, title, content, frontmatter_json, source_doc_ids_json, created_at, updated_at, compiled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      frontmatter_json = excluded.frontmatter_json,
      source_doc_ids_json = excluded.source_doc_ids_json,
      updated_at = excluded.updated_at,
      compiled_at = excluded.compiled_at
  `).run(
    article.slug,
    article.title,
    article.content,
    JSON.stringify(article.frontmatter),
    JSON.stringify(article.sourceDocIds),
    now, now, now,
  )
}

export function getArticle(db: Database.Database, slug: string): Article | null {
  const row = db.prepare('SELECT * FROM kb_articles WHERE slug = ?').get(slug) as any
  if (!row) return null
  return rowToArticle(row)
}

export function listArticles(db: Database.Database): Article[] {
  const rows = db.prepare('SELECT * FROM kb_articles ORDER BY updated_at DESC').all() as any[]
  return rows.map(rowToArticle)
}

export function getArticlesByTag(db: Database.Database, tag: string): Article[] {
  const all = listArticles(db)
  return all.filter((a) => {
    const tags = (a.frontmatter.tags as string[]) ?? []
    return tags.includes(tag)
  })
}

export function deleteArticle(db: Database.Database, slug: string): void {
  db.prepare('DELETE FROM kb_articles WHERE slug = ?').run(slug)
}

function rowToArticle(row: any): Article {
  return {
    slug: row.slug,
    title: row.title,
    content: row.content,
    frontmatter: JSON.parse(row.frontmatter_json),
    sourceDocIds: JSON.parse(row.source_doc_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    compiledAt: row.compiled_at,
  }
}

// ── Entities ─────────────────────────────────────────────────────

interface UpsertEntityInput {
  type: string
  name: string
  articleSlug: string
  metadata: Record<string, unknown>
}

export function upsertEntity(db: Database.Database, entity: UpsertEntityInput): void {
  db.prepare(`
    INSERT INTO kb_entities (type, name, article_slug, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(entity.type, entity.name, entity.articleSlug, JSON.stringify(entity.metadata))
}

export function listEntities(db: Database.Database, options: EntityListOptions): Entity[] {
  let sql = 'SELECT * FROM kb_entities WHERE type = ?'
  const params: unknown[] = [options.type]

  if (options.where) {
    for (const [key, value] of Object.entries(options.where)) {
      sql += ` AND json_extract(metadata_json, '$.' || ?) = ?`
      params.push(key, value)
    }
  }

  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map(rowToEntity)
}

export function getEntity(
  db: Database.Database,
  type: string,
  name: string,
): (Entity & { article: Article | null }) | null {
  const row = db.prepare('SELECT * FROM kb_entities WHERE type = ? AND name = ?').get(type, name) as any
  if (!row) return null
  const entity = rowToEntity(row)
  const article = getArticle(db, entity.articleSlug)
  return { ...entity, article }
}

export function deleteEntitiesForArticle(db: Database.Database, articleSlug: string): void {
  db.prepare('DELETE FROM kb_entities WHERE article_slug = ?').run(articleSlug)
}

function rowToEntity(row: any): Entity {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    articleSlug: row.article_slug,
    metadata: JSON.parse(row.metadata_json),
    updatedAt: row.updated_at,
  }
}

// ── Index ────────────────────────────────────────────────────────

interface UpsertIndexInput {
  articleSlug: string
  summary: string
  tags: string[]
}

export function upsertIndexEntry(db: Database.Database, entry: UpsertIndexInput): void {
  db.prepare(`
    INSERT INTO kb_index (article_slug, summary, tags_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(article_slug) DO UPDATE SET
      summary = excluded.summary,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at
  `).run(entry.articleSlug, entry.summary, JSON.stringify(entry.tags))
}

export function getIndex(db: Database.Database): IndexEntry[] {
  const rows = db.prepare('SELECT * FROM kb_index ORDER BY article_slug').all() as any[]
  return rows.map(rowToIndexEntry)
}

export function searchIndex(db: Database.Database, query: string): IndexEntry[] {
  const lower = query.toLowerCase()
  const all = getIndex(db)
  return all.filter(
    (e) =>
      e.summary.toLowerCase().includes(lower) ||
      e.tags.some((t) => t.toLowerCase().includes(lower)),
  )
}

function rowToIndexEntry(row: any): IndexEntry {
  return {
    articleSlug: row.article_slug,
    summary: row.summary,
    tags: JSON.parse(row.tags_json),
    updatedAt: row.updated_at,
  }
}

// ── Stats ────────────────────────────────────────────────────────

export function getStats(db: Database.Database): KBStats {
  const rawCount = (db.prepare('SELECT COUNT(*) as c FROM kb_raw_documents').get() as any).c
  const articleCount = (db.prepare('SELECT COUNT(*) as c FROM kb_articles').get() as any).c
  const entityCount = (db.prepare('SELECT COUNT(*) as c FROM kb_entities').get() as any).c
  const lastRow = db
    .prepare('SELECT compiled_at FROM kb_articles ORDER BY compiled_at DESC LIMIT 1')
    .get() as any
  return {
    rawDocuments: rawCount,
    articles: articleCount,
    entities: entityCount,
    lastCompiled: lastRow?.compiled_at ?? null,
  }
}
