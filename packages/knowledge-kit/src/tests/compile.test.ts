import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema, insertRawDocument, getArticle, listArticles, listEntities, getIndex, getUncompiledDocuments } from '../db.js'
import { compileIncremental, compileAll } from '../compile.js'
import type { GenerateFn, KnowledgeBaseConfig } from '../types.js'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

function createMockConfig(): KnowledgeBaseConfig {
  return {
    entityTypes: ['contact', 'organization'],
    compilationPrompt: 'Compile articles about people.',
    extractionPrompt: 'Extract contacts and organizations.',
    indexPrompt: 'Summarize each article in one line.',
  }
}

function createMockGenerate(overrides?: {
  compilation?: object
  extraction?: object
  index?: object
}): GenerateFn {
  let callCount = 0
  return async (prompt: string): Promise<string> => {
    callCount++
    if (prompt.includes('compiler') || callCount === 1) {
      return JSON.stringify(
        overrides?.compilation ?? {
          articles: [
            {
              slug: 'dr-smith',
              title: 'Dr. Smith',
              content: '# Dr. Smith\n\nBCBA at Bright ABA.',
              frontmatter: { tags: ['therapy'] },
              sourceDocIds: ['email-001'],
            },
          ],
        },
      )
    }
    if (prompt.includes('extractor') || callCount === 2) {
      return JSON.stringify(
        overrides?.extraction ?? {
          entities: [
            {
              type: 'contact',
              name: 'Dr. Smith',
              articleSlug: 'dr-smith',
              metadata: { role: 'BCBA', email: 'dr.smith@brightaba.com' },
            },
          ],
        },
      )
    }
    return JSON.stringify(
      overrides?.index ?? {
        entries: [
          {
            articleSlug: 'dr-smith',
            summary: 'ABA therapist at Bright ABA clinic',
            tags: ['therapy', 'aba'],
          },
        ],
      },
    )
  }
}

describe('compileIncremental', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('compiles uncompiled documents into articles, entities, and index', async () => {
    insertRawDocument(db, {
      sourceId: 'email-001',
      sourceType: 'email',
      content: 'From: dr.smith@brightaba.com\nSession went well today.',
    })

    const result = await compileIncremental(db, createMockGenerate(), createMockConfig())

    expect(result.documentsProcessed).toBe(1)
    expect(result.articlesCreated).toBe(1)
    expect(result.entitiesUpdated).toBeGreaterThan(0)

    const article = getArticle(db, 'dr-smith')
    expect(article).not.toBeNull()
    expect(article!.content).toContain('Dr. Smith')

    const contacts = listEntities(db, { type: 'contact' })
    expect(contacts).toHaveLength(1)
    expect(contacts[0].name).toBe('Dr. Smith')

    const index = getIndex(db)
    expect(index).toHaveLength(1)
    expect(index[0].summary).toContain('ABA')

    const uncompiled = getUncompiledDocuments(db)
    expect(uncompiled).toHaveLength(0)
  })

  it('does nothing when no uncompiled documents', async () => {
    const generate = createMockGenerate()
    const result = await compileIncremental(db, generate, createMockConfig())
    expect(result.documentsProcessed).toBe(0)
    expect(result.articlesCreated).toBe(0)
  })

  it('updates existing articles when new docs reference them', async () => {
    insertRawDocument(db, { sourceId: 'email-001', sourceType: 'email', content: 'First email from Dr. Smith' })
    await compileIncremental(db, createMockGenerate(), createMockConfig())

    insertRawDocument(db, { sourceId: 'email-002', sourceType: 'email', content: 'Second email from Dr. Smith' })
    const updatedGenerate = createMockGenerate({
      compilation: {
        articles: [
          {
            slug: 'dr-smith',
            title: 'Dr. Smith — Updated',
            content: '# Dr. Smith\n\nBCBA. Two sessions.',
            frontmatter: { tags: ['therapy'] },
            sourceDocIds: ['email-001', 'email-002'],
          },
        ],
      },
    })
    const result = await compileIncremental(db, updatedGenerate, createMockConfig())
    expect(result.articlesUpdated).toBe(1)

    const article = getArticle(db, 'dr-smith')
    expect(article!.title).toBe('Dr. Smith — Updated')
    expect(article!.sourceDocIds).toEqual(['email-001', 'email-002'])
  })
})

describe('compileAll', () => {
  it('recompiles all articles from scratch', async () => {
    const db = createTestDb()
    insertRawDocument(db, { sourceId: 'email-001', sourceType: 'email', content: 'Email 1' })
    insertRawDocument(db, { sourceId: 'email-002', sourceType: 'email', content: 'Email 2' })

    await compileIncremental(db, createMockGenerate(), createMockConfig())

    const recompileGenerate = createMockGenerate({
      compilation: {
        articles: [
          {
            slug: 'dr-smith',
            title: 'Dr. Smith — Recompiled',
            content: '# Dr. Smith\n\nFull recompile.',
            frontmatter: {},
            sourceDocIds: ['email-001', 'email-002'],
          },
        ],
      },
    })
    const result = await compileAll(db, recompileGenerate, createMockConfig())
    expect(result.documentsProcessed).toBe(2)

    const article = getArticle(db, 'dr-smith')
    expect(article!.title).toBe('Dr. Smith — Recompiled')
  })
})
