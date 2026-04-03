import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema, upsertArticle, upsertEntity, upsertIndexEntry } from '../db.js'
import { createQueryLayer } from '../query.js'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

function seedTestKB(db: Database.Database) {
  upsertArticle(db, {
    slug: 'dr-smith',
    title: 'Dr. Smith — ABA Therapy',
    content: '# Dr. Smith\n\nBCBA at Bright ABA. Next session March 15.',
    frontmatter: { tags: ['therapy', 'aba'] },
    sourceDocIds: ['email-001'],
  })
  upsertArticle(db, {
    slug: 'lincoln-school',
    title: 'Lincoln Elementary',
    content: '# Lincoln Elementary\n\nIEP meeting scheduled for April 10.',
    frontmatter: { tags: ['school'] },
    sourceDocIds: ['email-002'],
  })
  upsertEntity(db, { type: 'contact', name: 'Dr. Smith', articleSlug: 'dr-smith', metadata: { role: 'BCBA' } })
  upsertEntity(db, { type: 'organization', name: 'Bright ABA', articleSlug: 'dr-smith', metadata: { domain: 'brightaba.com' } })
  upsertEntity(db, { type: 'organization', name: 'Lincoln Elementary', articleSlug: 'lincoln-school', metadata: { domain: 'lincoln.edu' } })
  upsertIndexEntry(db, { articleSlug: 'dr-smith', summary: 'ABA therapist at Bright ABA', tags: ['therapy'] })
  upsertIndexEntry(db, { articleSlug: 'lincoln-school', summary: 'IEP and school coordination', tags: ['school'] })
}

describe('query layer — articles', () => {
  let db: Database.Database
  let q: ReturnType<typeof createQueryLayer>

  beforeEach(() => {
    db = createTestDb()
    seedTestKB(db)
    q = createQueryLayer(db)
  })

  it('lists all articles', () => {
    expect(q.articles.list()).toHaveLength(2)
  })

  it('filters articles by tag', () => {
    const therapy = q.articles.list({ tag: 'therapy' })
    expect(therapy).toHaveLength(1)
    expect(therapy[0].slug).toBe('dr-smith')
  })

  it('gets a single article', () => {
    const article = q.articles.get('dr-smith')
    expect(article).not.toBeNull()
    expect(article!.title).toBe('Dr. Smith — ABA Therapy')
  })

  it('returns null for missing article', () => {
    expect(q.articles.get('nonexistent')).toBeNull()
  })

  it('searches index', () => {
    const results = q.articles.search('IEP')
    expect(results).toHaveLength(1)
    expect(results[0].articleSlug).toBe('lincoln-school')
  })
})

describe('query layer — entities', () => {
  let db: Database.Database
  let q: ReturnType<typeof createQueryLayer>

  beforeEach(() => {
    db = createTestDb()
    seedTestKB(db)
    q = createQueryLayer(db)
  })

  it('lists entities by type', () => {
    const contacts = q.entities.list({ type: 'contact' })
    expect(contacts).toHaveLength(1)
    expect(contacts[0].name).toBe('Dr. Smith')
  })

  it('filters entities by metadata', () => {
    const bcbas = q.entities.list({ type: 'contact', where: { role: 'BCBA' } })
    expect(bcbas).toHaveLength(1)
  })

  it('returns empty for non-matching filter', () => {
    const rbt = q.entities.list({ type: 'contact', where: { role: 'RBT' } })
    expect(rbt).toHaveLength(0)
  })

  it('gets entity with its article', () => {
    const result = q.entities.get('contact', 'Dr. Smith')
    expect(result).not.toBeNull()
    expect(result!.article).not.toBeNull()
    expect(result!.article!.slug).toBe('dr-smith')
  })

  it('returns null for missing entity', () => {
    expect(q.entities.get('contact', 'Nobody')).toBeNull()
  })
})

describe('query layer — index', () => {
  it('returns all index entries', () => {
    const db = createTestDb()
    seedTestKB(db)
    const q = createQueryLayer(db)
    const index = q.index.get()
    expect(index).toHaveLength(2)
  })
})
