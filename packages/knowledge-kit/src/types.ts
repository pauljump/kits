import type Database from 'better-sqlite3'

// ── Raw Documents ────────────────────────────────────────────────

export interface RawDocument {
  sourceId: string
  sourceType: string
  content: string
  metadata?: Record<string, unknown>
  title?: string
  sourceUrl?: string
  createdAt?: string
}

export interface StoredRawDocument extends RawDocument {
  id: string
  metadataJson: string
  ingestedAt: string
  compiled: boolean
}

// ── Articles ─────────────────────────────────────────────────────

export interface Article {
  slug: string
  title: string
  content: string
  frontmatter: Record<string, unknown>
  sourceDocIds: string[]
  createdAt: string
  updatedAt: string
  compiledAt: string
}

export interface ArticleListOptions {
  tag?: string
}

// ── Entities ─────────────────────────────────────────────────────

export interface Entity {
  id: string
  type: string
  name: string
  articleSlug: string
  metadata: Record<string, unknown>
  updatedAt: string
}

export interface EntityListOptions {
  type: string
  where?: Record<string, unknown>
}

// ── Index ────────────────────────────────────────────────────────

export interface IndexEntry {
  articleSlug: string
  summary: string
  tags: string[]
  updatedAt: string
}

// ── Compilation ──────────────────────────────────────────────────

export interface CompileResult {
  documentsProcessed: number
  articlesCreated: number
  articlesUpdated: number
  entitiesUpdated: number
}

/** LLM response for article compilation */
export interface CompilationOutput {
  articles: Array<{
    slug: string
    title: string
    content: string
    frontmatter: Record<string, unknown>
    sourceDocIds: string[]
  }>
}

/** LLM response for entity extraction */
export interface ExtractionOutput {
  entities: Array<{
    type: string
    name: string
    articleSlug: string
    metadata: Record<string, unknown>
  }>
}

/** LLM response for index update */
export interface IndexOutput {
  entries: Array<{
    articleSlug: string
    summary: string
    tags: string[]
  }>
}

/** LLM response for ask — article selection */
export interface AskSelectionOutput {
  articleSlugs: string[]
}

// ── Ask ──────────────────────────────────────────────────────────

export interface AskResult {
  answer: string
  sources: string[]
}

// ── Stats ────────────────────────────────────────────────────────

export interface KBStats {
  rawDocuments: number
  articles: number
  entities: number
  lastCompiled: string | null
}

// ── Config ───────────────────────────────────────────────────────

export type GenerateFn = (prompt: string) => Promise<string>

export interface KnowledgeBaseConfig {
  entityTypes: string[]
  compilationPrompt: string
  extractionPrompt: string
  indexPrompt: string
}

export interface CreateKnowledgeBaseOptions {
  db: Database.Database
  generate: GenerateFn
  config: KnowledgeBaseConfig
}

// ── Public API ───────────────────────────────────────────────────

export interface KnowledgeBase {
  ingest(doc: RawDocument): void
  ingestBatch(docs: RawDocument[]): void
  compile(): Promise<CompileResult>
  recompile(): Promise<CompileResult>
  rebuildEntities(): Promise<void>
  ask(question: string): Promise<AskResult>
  stats(): KBStats
  articles: {
    list(options?: ArticleListOptions): Article[]
    get(slug: string): Article | null
    search(query: string): IndexEntry[]
  }
  entities: {
    list(options?: EntityListOptions): Entity[]
    get(type: string, name: string): (Entity & { article: Article | null }) | null
  }
  index: {
    get(): IndexEntry[]
  }
}
