import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { createKnowledgeBase } from '../index.js'
import type { GenerateFn } from '../types.js'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function createFullMockGenerate(): GenerateFn {
  let callCount = 0
  return async (prompt: string): Promise<string> => {
    callCount++
    if (prompt.includes('compiler')) {
      return JSON.stringify({
        articles: [
          {
            slug: 'dr-smith',
            title: 'Dr. Smith — ABA Therapy',
            content: '# Dr. Smith\n\nBCBA at Bright ABA. Weekly sessions.',
            frontmatter: { tags: ['therapy'] },
            sourceDocIds: ['email-001', 'email-002'],
          },
        ],
      })
    }
    if (prompt.includes('extractor')) {
      return JSON.stringify({
        entities: [
          { type: 'contact', name: 'Dr. Smith', articleSlug: 'dr-smith', metadata: { role: 'BCBA' } },
        ],
      })
    }
    if (prompt.includes('indexer')) {
      return JSON.stringify({
        entries: [{ articleSlug: 'dr-smith', summary: 'ABA therapist', tags: ['therapy'] }],
      })
    }
    if (prompt.includes('select which articles')) {
      return JSON.stringify({ articleSlugs: ['dr-smith'] })
    }
    if (prompt.includes('Answer the user')) {
      return JSON.stringify({ answer: 'Dr. Smith has weekly sessions.', sources: ['dr-smith'] })
    }
    return '{}'
  }
}

describe('createKnowledgeBase — full integration', () => {
  it('ingest → compile → query → ask flow', async () => {
    const db = createTestDb()
    const kb = createKnowledgeBase({
      db,
      generate: createFullMockGenerate(),
      config: {
        entityTypes: ['contact', 'organization'],
        compilationPrompt: 'Compile articles about care team.',
        extractionPrompt: 'Extract contacts.',
        indexPrompt: 'Summarize each article.',
      },
    })

    kb.ingest({
      sourceId: 'email-001',
      sourceType: 'email',
      content: 'From: dr.smith@brightaba.com\nSession went great.',
      title: 'Session update',
    })
    kb.ingest({
      sourceId: 'email-002',
      sourceType: 'email',
      content: 'From: dr.smith@brightaba.com\nWeekly check-in.',
    })

    const beforeStats = kb.stats()
    expect(beforeStats.rawDocuments).toBe(2)
    expect(beforeStats.articles).toBe(0)

    const result = await kb.compile()
    expect(result.documentsProcessed).toBe(2)
    expect(result.articlesCreated).toBe(1)

    const articles = kb.articles.list()
    expect(articles).toHaveLength(1)
    expect(articles[0]!.slug).toBe('dr-smith')

    const therapy = kb.articles.list({ tag: 'therapy' })
    expect(therapy).toHaveLength(1)

    const article = kb.articles.get('dr-smith')
    expect(article).not.toBeNull()

    const contacts = kb.entities.list({ type: 'contact' })
    expect(contacts).toHaveLength(1)
    expect(contacts[0]!.name).toBe('Dr. Smith')

    const bcba = kb.entities.get('contact', 'Dr. Smith')
    expect(bcba).not.toBeNull()
    expect(bcba!.article!.slug).toBe('dr-smith')

    const index = kb.index.get()
    expect(index).toHaveLength(1)

    const searchResults = kb.articles.search('ABA')
    expect(searchResults).toHaveLength(1)

    const answer = await kb.ask('How often does Dr. Smith have sessions?')
    expect(answer.answer).toContain('weekly')
    expect(answer.sources).toContain('dr-smith')

    const afterStats = kb.stats()
    expect(afterStats.articles).toBe(1)
    expect(afterStats.entities).toBe(1)
  })

  it('ingestBatch works', () => {
    const db = createTestDb()
    const kb = createKnowledgeBase({
      db,
      generate: async () => '{}',
      config: { entityTypes: [], compilationPrompt: '', extractionPrompt: '', indexPrompt: '' },
    })

    kb.ingestBatch([
      { sourceId: 'a', sourceType: 'email', content: 'A' },
      { sourceId: 'b', sourceType: 'email', content: 'B' },
      { sourceId: 'c', sourceType: 'email', content: 'C' },
    ])

    expect(kb.stats().rawDocuments).toBe(3)
  })

  it('deduplicates on ingest', () => {
    const db = createTestDb()
    const kb = createKnowledgeBase({
      db,
      generate: async () => '{}',
      config: { entityTypes: [], compilationPrompt: '', extractionPrompt: '', indexPrompt: '' },
    })

    kb.ingest({ sourceId: 'a', sourceType: 'email', content: 'Version 1' })
    kb.ingest({ sourceId: 'a', sourceType: 'email', content: 'Version 2' })
    expect(kb.stats().rawDocuments).toBe(1)
  })

  it('recompile rebuilds everything', async () => {
    const db = createTestDb()
    const generate = createFullMockGenerate()
    const kb = createKnowledgeBase({
      db,
      generate,
      config: {
        entityTypes: ['contact'],
        compilationPrompt: 'Compile.',
        extractionPrompt: 'Extract.',
        indexPrompt: 'Summarize.',
      },
    })

    kb.ingest({ sourceId: 'email-001', sourceType: 'email', content: 'Email 1' })
    await kb.compile()
    expect(kb.stats().articles).toBe(1)

    const result = await kb.recompile()
    expect(result.documentsProcessed).toBe(1)
  })

  it('rebuildEntities re-extracts from existing articles', async () => {
    const db = createTestDb()
    const generate = createFullMockGenerate()
    const kb = createKnowledgeBase({
      db,
      generate,
      config: {
        entityTypes: ['contact'],
        compilationPrompt: 'Compile.',
        extractionPrompt: 'Extract.',
        indexPrompt: 'Summarize.',
      },
    })

    kb.ingest({ sourceId: 'email-001', sourceType: 'email', content: 'Email 1' })
    await kb.compile()

    db.prepare('DELETE FROM kb_entities').run()
    expect(kb.entities.list({ type: 'contact' })).toHaveLength(0)

    await kb.rebuildEntities()
    expect(kb.entities.list({ type: 'contact' })).toHaveLength(1)
  })
})
