import type {
  RawDocument,
  KnowledgeBase,
  CreateKnowledgeBaseOptions,
  CompileResult,
  AskResult,
  KBStats,
} from './types.js'
import { initSchema, insertRawDocument, getStats } from './db.js'
import { compileIncremental, compileAll, extractEntitiesFromArticles } from './compile.js'
import { createQueryLayer, ask } from './query.js'

export { KNOWLEDGE_SCHEMA } from './schema-sql.js'

export type {
  RawDocument,
  Article,
  Entity,
  IndexEntry,
  KnowledgeBase,
  KnowledgeBaseConfig,
  CreateKnowledgeBaseOptions,
  CompileResult,
  AskResult,
  KBStats,
  GenerateFn,
  ArticleListOptions,
  EntityListOptions,
} from './types.js'

export function createKnowledgeBase(options: CreateKnowledgeBaseOptions): KnowledgeBase {
  const { db, generate, config } = options

  initSchema(db)

  const queries = createQueryLayer(db)

  return {
    ingest(doc: RawDocument): void {
      insertRawDocument(db, doc)
    },

    ingestBatch(docs: RawDocument[]): void {
      const insert = db.transaction(() => {
        for (const doc of docs) {
          insertRawDocument(db, doc)
        }
      })
      insert()
    },

    compile(): Promise<CompileResult> {
      return compileIncremental(db, generate, config)
    },

    recompile(): Promise<CompileResult> {
      return compileAll(db, generate, config)
    },

    rebuildEntities(): Promise<void> {
      return extractEntitiesFromArticles(db, generate, config)
    },

    ask(question: string): Promise<AskResult> {
      return ask(db, generate, question)
    },

    stats(): KBStats {
      return getStats(db)
    },

    articles: queries.articles,
    entities: queries.entities,
    index: queries.index,
  }
}
