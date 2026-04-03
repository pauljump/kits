import type Database from 'better-sqlite3'
import type {
  GenerateFn,
  KnowledgeBaseConfig,
  CompileResult,
  CompilationOutput,
  ExtractionOutput,
  IndexOutput,
} from './types.js'
import {
  getUncompiledDocuments,
  markDocumentsCompiled,
  upsertArticle,
  getArticle,
  listArticles,
  deleteEntitiesForArticle,
  upsertEntity,
  upsertIndexEntry,
  getIndex,
} from './db.js'

export async function compileIncremental(
  db: Database.Database,
  generate: GenerateFn,
  config: KnowledgeBaseConfig,
): Promise<CompileResult> {
  const uncompiled = getUncompiledDocuments(db)
  if (uncompiled.length === 0) {
    return { documentsProcessed: 0, articlesCreated: 0, articlesUpdated: 0, entitiesUpdated: 0 }
  }

  const currentIndex = getIndex(db)
  const existingArticles = listArticles(db)

  const compilationPrompt = buildCompilationPrompt(
    config.compilationPrompt,
    uncompiled.map((d) => ({
      sourceId: d.sourceId,
      sourceType: d.sourceType,
      title: d.title ?? undefined,
      content: d.content,
    })),
    existingArticles.map((a) => ({
      slug: a.slug,
      title: a.title,
      summary: currentIndex.find((i) => i.articleSlug === a.slug)?.summary ?? '',
    })),
  )

  const compilationRaw = await generate(compilationPrompt)
  const compilation = parseJSON<CompilationOutput>(compilationRaw)

  let articlesCreated = 0
  let articlesUpdated = 0

  for (const article of compilation.articles) {
    const existing = getArticle(db, article.slug)
    if (existing) {
      articlesUpdated++
    } else {
      articlesCreated++
    }
    upsertArticle(db, {
      slug: article.slug,
      title: article.title,
      content: article.content,
      frontmatter: article.frontmatter,
      sourceDocIds: article.sourceDocIds,
    })
  }

  const entitiesUpdated = await extractEntities(db, generate, config, compilation.articles.map((a) => a.slug))
  await updateIndex(db, generate, config, compilation.articles.map((a) => a.slug))
  markDocumentsCompiled(db, uncompiled.map((d) => d.sourceId))

  return { documentsProcessed: uncompiled.length, articlesCreated, articlesUpdated, entitiesUpdated }
}

export async function compileAll(
  db: Database.Database,
  generate: GenerateFn,
  config: KnowledgeBaseConfig,
): Promise<CompileResult> {
  db.prepare('UPDATE kb_raw_documents SET compiled = 0').run()
  return compileIncremental(db, generate, config)
}

export async function extractEntitiesFromArticles(
  db: Database.Database,
  generate: GenerateFn,
  config: KnowledgeBaseConfig,
): Promise<void> {
  const articles = listArticles(db)
  await extractEntities(db, generate, config, articles.map((a) => a.slug))
}

async function extractEntities(
  db: Database.Database,
  generate: GenerateFn,
  config: KnowledgeBaseConfig,
  articleSlugs: string[],
): Promise<number> {
  if (articleSlugs.length === 0) return 0

  const articles = articleSlugs
    .map((slug) => getArticle(db, slug))
    .filter((a): a is NonNullable<typeof a> => a !== null)

  const extractionPrompt = buildExtractionPrompt(config.extractionPrompt, config.entityTypes, articles)
  const extractionRaw = await generate(extractionPrompt)
  const extraction = parseJSON<ExtractionOutput>(extractionRaw)

  for (const slug of articleSlugs) {
    deleteEntitiesForArticle(db, slug)
  }

  for (const entity of extraction.entities) {
    if (config.entityTypes.includes(entity.type)) {
      upsertEntity(db, {
        type: entity.type,
        name: entity.name,
        articleSlug: entity.articleSlug,
        metadata: entity.metadata,
      })
    }
  }

  return extraction.entities.length
}

async function updateIndex(
  db: Database.Database,
  generate: GenerateFn,
  config: KnowledgeBaseConfig,
  articleSlugs: string[],
): Promise<void> {
  if (articleSlugs.length === 0) return

  const articles = articleSlugs
    .map((slug) => getArticle(db, slug))
    .filter((a): a is NonNullable<typeof a> => a !== null)

  const indexPrompt = buildIndexPrompt(config.indexPrompt, articles)
  const indexRaw = await generate(indexPrompt)
  const indexOutput = parseJSON<IndexOutput>(indexRaw)

  for (const entry of indexOutput.entries) {
    upsertIndexEntry(db, {
      articleSlug: entry.articleSlug,
      summary: entry.summary,
      tags: entry.tags,
    })
  }
}

function buildCompilationPrompt(
  userPrompt: string,
  newDocs: Array<{ sourceId: string; sourceType: string; title?: string; content: string }>,
  existingArticles: Array<{ slug: string; title: string; summary: string }>,
): string {
  let prompt = `You are a knowledge base compiler. Your job is to compile raw source documents into well-structured markdown articles.\n\n`
  prompt += `## Instructions\n${userPrompt}\n\n`

  if (existingArticles.length > 0) {
    prompt += `## Existing Articles (update these if relevant, or create new ones)\n`
    for (const a of existingArticles) {
      prompt += `- **${a.slug}**: ${a.title} — ${a.summary}\n`
    }
    prompt += `\n`
  }

  prompt += `## New Source Documents\n`
  for (const doc of newDocs) {
    prompt += `### [${doc.sourceType}] ${doc.title ?? doc.sourceId}\n`
    prompt += `Source ID: ${doc.sourceId}\n`
    prompt += `${doc.content}\n\n`
  }

  prompt += `## Output Format\nRespond with a JSON object matching this structure:\n`
  prompt += `{"articles": [{"slug": "url-safe-slug", "title": "Human Title", "content": "# Markdown content...", "frontmatter": {"tags": ["tag1"]}, "sourceDocIds": ["source-id-1"]}]}\n`
  prompt += `\nIMPORTANT: sourceDocIds must list ALL source document IDs that informed each article (not just the new ones). If updating an existing article, include its previous sourceDocIds plus any new ones.\n`
  prompt += `Respond ONLY with valid JSON. No markdown fences, no explanation.`

  return prompt
}

function buildExtractionPrompt(
  userPrompt: string,
  entityTypes: string[],
  articles: Array<{ slug: string; title: string; content: string }>,
): string {
  let prompt = `You are an entity extractor. Extract structured entities from the following articles.\n\n`
  prompt += `## Instructions\n${userPrompt}\n\n`
  prompt += `## Entity Types\n${entityTypes.join(', ')}\n\n`

  prompt += `## Articles\n`
  for (const a of articles) {
    prompt += `### ${a.slug}: ${a.title}\n${a.content}\n\n`
  }

  prompt += `## Output Format\nRespond with a JSON object:\n`
  prompt += `{"entities": [{"type": "entity-type", "name": "Display Name", "articleSlug": "article-slug", "metadata": {...}}]}\n`
  prompt += `Respond ONLY with valid JSON. No markdown fences, no explanation.`

  return prompt
}

function buildIndexPrompt(
  userPrompt: string,
  articles: Array<{ slug: string; title: string; content: string }>,
): string {
  let prompt = `You are an indexer. Write a one-line summary and tags for each article.\n\n`
  prompt += `## Instructions\n${userPrompt}\n\n`

  prompt += `## Articles\n`
  for (const a of articles) {
    prompt += `### ${a.slug}: ${a.title}\n${a.content}\n\n`
  }

  prompt += `## Output Format\nRespond with a JSON object:\n`
  prompt += `{"entries": [{"articleSlug": "slug", "summary": "One-line summary", "tags": ["tag1", "tag2"]}]}\n`
  prompt += `Respond ONLY with valid JSON. No markdown fences, no explanation.`

  return prompt
}

function parseJSON<T>(raw: string): T {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  try {
    return JSON.parse(cleaned) as T
  } catch {
    throw new Error(`knowledge-kit: failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`)
  }
}
