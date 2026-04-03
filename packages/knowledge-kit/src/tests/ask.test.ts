import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema, upsertArticle, upsertIndexEntry } from '../db.js'
import { ask } from '../query.js'
import type { GenerateFn } from '../types.js'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

function seedForAsk(db: Database.Database) {
  upsertArticle(db, {
    slug: 'dr-smith',
    title: 'Dr. Smith',
    content: '# Dr. Smith\n\nBCBA. Next session March 15.',
    frontmatter: {},
    sourceDocIds: [],
  })
  upsertArticle(db, {
    slug: 'lincoln-school',
    title: 'Lincoln Elementary',
    content: '# Lincoln Elementary\n\nIEP meeting April 10.',
    frontmatter: {},
    sourceDocIds: [],
  })
  upsertIndexEntry(db, { articleSlug: 'dr-smith', summary: 'ABA therapist', tags: ['therapy'] })
  upsertIndexEntry(db, { articleSlug: 'lincoln-school', summary: 'IEP and school', tags: ['school'] })
}

describe('ask', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    seedForAsk(db)
  })

  it('makes two LLM calls — selection then answer', async () => {
    const calls: string[] = []
    const generate: GenerateFn = async (prompt: string) => {
      calls.push(prompt.slice(0, 50))
      if (calls.length === 1) {
        return JSON.stringify({ articleSlugs: ['lincoln-school'] })
      }
      return JSON.stringify({
        answer: 'The IEP meeting is scheduled for April 10.',
        sources: ['lincoln-school'],
      })
    }

    const result = await ask(db, generate, 'When is the IEP meeting?')
    expect(calls).toHaveLength(2)
    expect(result.answer).toContain('April 10')
    expect(result.sources).toEqual(['lincoln-school'])
  })

  it('returns no-info answer when no articles match', async () => {
    const generate: GenerateFn = async () => {
      return JSON.stringify({ articleSlugs: [] })
    }
    const result = await ask(db, generate, 'What color is the sky?')
    expect(result.sources).toHaveLength(0)
  })
})
