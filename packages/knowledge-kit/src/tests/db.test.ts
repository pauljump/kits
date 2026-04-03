import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { KNOWLEDGE_SCHEMA } from '../schema-sql.js'
import {
  initSchema,
  insertRawDocument,
  getRawDocument,
  getUncompiledDocuments,
  markDocumentsCompiled,
  upsertArticle,
  getArticle,
  listArticles,
  getArticlesByTag,
  deleteArticle,
  upsertEntity,
  listEntities,
  getEntity,
  deleteEntitiesForArticle,
  upsertIndexEntry,
  getIndex,
  searchIndex,
  getStats,
} from '../db.js'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

describe('initSchema', () => {
  it('creates all 4 tables', () => {
    const db = createTestDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kb_%'")
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name).sort()
    expect(names).toEqual([
      'kb_articles',
      'kb_entities',
      'kb_index',
      'kb_raw_documents',
    ])
  })

  it('is idempotent', () => {
    const db = createTestDb()
    expect(() => initSchema(db)).not.toThrow()
  })
})

describe('raw documents', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('inserts and retrieves a document', () => {
    insertRawDocument(db, {
      sourceId: 'email-001',
      sourceType: 'email',
      content: 'Hello from Dr. Smith',
      title: 'Session update',
      metadata: { from: 'dr.smith@example.com' },
    })
    const doc = getRawDocument(db, 'email-001')
    expect(doc).not.toBeNull()
    expect(doc!.sourceId).toBe('email-001')
    expect(doc!.content).toBe('Hello from Dr. Smith')
    expect(doc!.compiled).toBe(false)
    expect(JSON.parse(doc!.metadataJson)).toEqual({ from: 'dr.smith@example.com' })
  })

  it('deduplicates on sourceId — updates content', () => {
    insertRawDocument(db, {
      sourceId: 'email-001',
      sourceType: 'email',
      content: 'Version 1',
    })
    insertRawDocument(db, {
      sourceId: 'email-001',
      sourceType: 'email',
      content: 'Version 2',
    })
    const doc = getRawDocument(db, 'email-001')
    expect(doc!.content).toBe('Version 2')
    expect(doc!.compiled).toBe(false)
  })

  it('returns uncompiled documents', () => {
    insertRawDocument(db, { sourceId: 'a', sourceType: 'email', content: 'A' })
    insertRawDocument(db, { sourceId: 'b', sourceType: 'email', content: 'B' })
    markDocumentsCompiled(db, ['a'])
    const uncompiled = getUncompiledDocuments(db)
    expect(uncompiled).toHaveLength(1)
    expect(uncompiled[0].sourceId).toBe('b')
  })
})

describe('articles', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('upserts and retrieves an article', () => {
    upsertArticle(db, {
      slug: 'dr-smith',
      title: 'Dr. Smith — ABA Therapy',
      content: '# Dr. Smith\n\nBCBA at Bright ABA.',
      frontmatter: { tags: ['therapy', 'aba'] },
      sourceDocIds: ['email-001', 'email-002'],
    })
    const article = getArticle(db, 'dr-smith')
    expect(article).not.toBeNull()
    expect(article!.title).toBe('Dr. Smith — ABA Therapy')
    expect(article!.frontmatter).toEqual({ tags: ['therapy', 'aba'] })
    expect(article!.sourceDocIds).toEqual(['email-001', 'email-002'])
  })

  it('updates existing article on upsert', () => {
    upsertArticle(db, {
      slug: 'dr-smith',
      title: 'V1',
      content: 'Old',
      frontmatter: {},
      sourceDocIds: [],
    })
    upsertArticle(db, {
      slug: 'dr-smith',
      title: 'V2',
      content: 'New',
      frontmatter: { updated: true },
      sourceDocIds: ['email-003'],
    })
    const article = getArticle(db, 'dr-smith')
    expect(article!.title).toBe('V2')
    expect(article!.content).toBe('New')
  })

  it('lists all articles', () => {
    upsertArticle(db, { slug: 'a', title: 'A', content: '', frontmatter: {}, sourceDocIds: [] })
    upsertArticle(db, { slug: 'b', title: 'B', content: '', frontmatter: {}, sourceDocIds: [] })
    expect(listArticles(db)).toHaveLength(2)
  })

  it('filters articles by tag', () => {
    upsertArticle(db, { slug: 'a', title: 'A', content: '', frontmatter: { tags: ['therapy'] }, sourceDocIds: [] })
    upsertArticle(db, { slug: 'b', title: 'B', content: '', frontmatter: { tags: ['school'] }, sourceDocIds: [] })
    const results = getArticlesByTag(db, 'therapy')
    expect(results).toHaveLength(1)
    expect(results[0].slug).toBe('a')
  })

  it('cascades delete to entities and index', () => {
    upsertArticle(db, { slug: 'a', title: 'A', content: '', frontmatter: {}, sourceDocIds: [] })
    upsertEntity(db, { type: 'contact', name: 'Smith', articleSlug: 'a', metadata: {} })
    upsertIndexEntry(db, { articleSlug: 'a', summary: 'About A', tags: [] })
    deleteArticle(db, 'a')
    expect(listEntities(db, { type: 'contact' })).toHaveLength(0)
    expect(getIndex(db)).toHaveLength(0)
  })
})

describe('entities', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    upsertArticle(db, { slug: 'dr-smith', title: 'Dr. Smith', content: '', frontmatter: {}, sourceDocIds: [] })
  })

  it('inserts and lists entities by type', () => {
    upsertEntity(db, { type: 'contact', name: 'Dr. Smith', articleSlug: 'dr-smith', metadata: { role: 'BCBA' } })
    upsertEntity(db, { type: 'contact', name: 'Ms. Jones', articleSlug: 'dr-smith', metadata: { role: 'RBT' } })
    const contacts = listEntities(db, { type: 'contact' })
    expect(contacts).toHaveLength(2)
  })

  it('filters entities by metadata', () => {
    upsertEntity(db, { type: 'contact', name: 'Dr. Smith', articleSlug: 'dr-smith', metadata: { role: 'BCBA' } })
    upsertEntity(db, { type: 'contact', name: 'Ms. Jones', articleSlug: 'dr-smith', metadata: { role: 'RBT' } })
    const bcbas = listEntities(db, { type: 'contact', where: { role: 'BCBA' } })
    expect(bcbas).toHaveLength(1)
    expect(bcbas[0].name).toBe('Dr. Smith')
  })

  it('gets entity with article', () => {
    upsertEntity(db, { type: 'contact', name: 'Dr. Smith', articleSlug: 'dr-smith', metadata: {} })
    const result = getEntity(db, 'contact', 'Dr. Smith')
    expect(result).not.toBeNull()
    expect(result!.article).not.toBeNull()
    expect(result!.article!.slug).toBe('dr-smith')
  })

  it('deletes entities for an article', () => {
    upsertEntity(db, { type: 'contact', name: 'A', articleSlug: 'dr-smith', metadata: {} })
    upsertEntity(db, { type: 'contact', name: 'B', articleSlug: 'dr-smith', metadata: {} })
    deleteEntitiesForArticle(db, 'dr-smith')
    expect(listEntities(db, { type: 'contact' })).toHaveLength(0)
  })
})

describe('index', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    upsertArticle(db, { slug: 'dr-smith', title: 'Dr. Smith', content: '', frontmatter: {}, sourceDocIds: [] })
    upsertArticle(db, { slug: 'iep-prep', title: 'IEP Prep', content: '', frontmatter: {}, sourceDocIds: [] })
  })

  it('upserts and retrieves index entries', () => {
    upsertIndexEntry(db, { articleSlug: 'dr-smith', summary: 'ABA therapist', tags: ['therapy'] })
    upsertIndexEntry(db, { articleSlug: 'iep-prep', summary: 'IEP meeting prep', tags: ['school'] })
    const index = getIndex(db)
    expect(index).toHaveLength(2)
  })

  it('searches index by query string', () => {
    upsertIndexEntry(db, { articleSlug: 'dr-smith', summary: 'ABA therapist at Bright clinic', tags: ['therapy'] })
    upsertIndexEntry(db, { articleSlug: 'iep-prep', summary: 'IEP meeting preparation notes', tags: ['school'] })
    const results = searchIndex(db, 'IEP')
    expect(results).toHaveLength(1)
    expect(results[0].articleSlug).toBe('iep-prep')
  })
})

describe('stats', () => {
  it('returns correct counts', () => {
    const db = createTestDb()
    insertRawDocument(db, { sourceId: 'a', sourceType: 'email', content: 'A' })
    insertRawDocument(db, { sourceId: 'b', sourceType: 'email', content: 'B' })
    upsertArticle(db, { slug: 'art-1', title: 'Art 1', content: '', frontmatter: {}, sourceDocIds: [] })
    upsertEntity(db, { type: 'contact', name: 'X', articleSlug: 'art-1', metadata: {} })
    const stats = getStats(db)
    expect(stats.rawDocuments).toBe(2)
    expect(stats.articles).toBe(1)
    expect(stats.entities).toBe(1)
  })
})
