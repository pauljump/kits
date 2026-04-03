# @pauljump/knowledge-kit

A platform package that gives any factory app a personal knowledge base. Raw documents go in, an LLM compiles them into structured markdown articles with a derived entity index, and the consumer can query both.

## Install

```bash
pnpm add @pauljump/knowledge-kit
```

Requires `better-sqlite3` as a peer dependency (provided by the consuming app).

## Quick Start

```typescript
import { createKnowledgeBase } from '@pauljump/knowledge-kit'
import Database from 'better-sqlite3'

const db = new Database('./knowledge.db')
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const kb = createKnowledgeBase({
  db,
  generate: async (prompt) => {
    // Your LLM call here — provider-agnostic
    return await callYourLLM(prompt)
  },
  config: {
    entityTypes: ['contact', 'organization'],
    compilationPrompt: 'Compile articles about people and organizations.',
    extractionPrompt: 'Extract contacts and organizations with metadata.',
    indexPrompt: 'Summarize each article in one line.',
  },
})

// Ingest raw documents
kb.ingest({
  sourceId: 'email-001',
  sourceType: 'email',
  content: 'From: dr.smith@example.com\nSession went well.',
  title: 'Session update',
})

// Compile — LLM processes uncompiled docs into articles
await kb.compile()

// Query articles
const articles = kb.articles.list({ tag: 'therapy' })
const article = kb.articles.get('dr-smith')

// Query entities (SQL, no LLM call)
const contacts = kb.entities.list({ type: 'contact', where: { role: 'BCBA' } })

// Ask questions (two LLM calls: select articles, then answer)
const answer = await kb.ask('When is the next session?')
```

## API

### `createKnowledgeBase(options)`

Creates a knowledge base instance.

**Options:**
- `db` — better-sqlite3 Database instance
- `generate` — `(prompt: string) => Promise<string>` — your LLM call
- `config.entityTypes` — consumer-defined entity type names
- `config.compilationPrompt` — how to compile raw docs into articles
- `config.extractionPrompt` — how to extract entities from articles
- `config.indexPrompt` — how to summarize articles for the index

### Methods

| Method | Description |
|--------|-------------|
| `ingest(doc)` | Push a raw document into the knowledge base |
| `ingestBatch(docs)` | Push multiple raw documents (transactional) |
| `compile()` | Incremental compile — process uncompiled docs |
| `recompile()` | Full recompile — rebuild all articles from all docs |
| `rebuildEntities()` | Re-extract entity index from existing articles |
| `ask(question)` | LLM-powered Q&A against the knowledge base |
| `stats()` | Raw document, article, and entity counts |
| `articles.list(options?)` | List articles, optionally filter by tag |
| `articles.get(slug)` | Get a single article by slug |
| `articles.search(query)` | Search index summaries and tags |
| `entities.list(options)` | List entities by type, optionally filter by metadata |
| `entities.get(type, name)` | Get entity with its parent article |
| `index.get()` | Get full table of contents |

## Architecture

- **Articles are source of truth.** Compiled markdown, maintained by LLM.
- **Entities are derived.** Structured index extracted from articles. Rebuildable.
- **Consumer provides all domain knowledge** via three prompts.
- **Push-only ingestion.** Consumer fetches data, pushes into knowledge-kit.
- **LLM is injected.** Consumer passes `generate` function. No provider dependency.
