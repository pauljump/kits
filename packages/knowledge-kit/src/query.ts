import type Database from 'better-sqlite3'
import type {
  Article,
  Entity,
  IndexEntry,
  ArticleListOptions,
  EntityListOptions,
  GenerateFn,
  AskResult,
  AskSelectionOutput,
} from './types.js'
import {
  listArticles,
  getArticle,
  getArticlesByTag,
  listEntities,
  getEntity,
  getIndex,
  searchIndex,
} from './db.js'

export function createQueryLayer(db: Database.Database) {
  return {
    articles: {
      list(options?: ArticleListOptions): Article[] {
        if (options?.tag) return getArticlesByTag(db, options.tag)
        return listArticles(db)
      },
      get(slug: string): Article | null {
        return getArticle(db, slug)
      },
      search(query: string): IndexEntry[] {
        return searchIndex(db, query)
      },
    },
    entities: {
      list(options: EntityListOptions): Entity[] {
        return listEntities(db, options)
      },
      get(type: string, name: string): (Entity & { article: Article | null }) | null {
        return getEntity(db, type, name)
      },
    },
    index: {
      get(): IndexEntry[] {
        return getIndex(db)
      },
    },
  }
}

export async function ask(
  db: Database.Database,
  generate: GenerateFn,
  question: string,
): Promise<AskResult> {
  const index = getIndex(db)

  if (index.length === 0) {
    return { answer: 'The knowledge base is empty. No information available.', sources: [] }
  }

  const selectionPrompt = buildSelectionPrompt(question, index)
  const selectionRaw = await generate(selectionPrompt)
  const selection = parseJSON<AskSelectionOutput>(selectionRaw)

  if (selection.articleSlugs.length === 0) {
    return { answer: 'No relevant information found in the knowledge base.', sources: [] }
  }

  const articles = selection.articleSlugs
    .map((slug) => getArticle(db, slug))
    .filter((a): a is Article => a !== null)

  if (articles.length === 0) {
    return { answer: 'No relevant information found in the knowledge base.', sources: [] }
  }

  const answerPrompt = buildAnswerPrompt(question, articles)
  const answerRaw = await generate(answerPrompt)
  const answerOutput = parseJSON<{ answer: string; sources: string[] }>(answerRaw)

  return {
    answer: answerOutput.answer,
    sources: answerOutput.sources,
  }
}

function buildSelectionPrompt(question: string, index: IndexEntry[]): string {
  let prompt = `You are a knowledge base assistant. A user has asked a question. Based on the index below, select which articles are likely to contain the answer.\n\n`
  prompt += `## Question\n${question}\n\n`
  prompt += `## Article Index\n`
  for (const entry of index) {
    prompt += `- **${entry.articleSlug}**: ${entry.summary} [tags: ${entry.tags.join(', ')}]\n`
  }
  prompt += `\n## Output Format\nRespond with a JSON object:\n{"articleSlugs": ["slug1", "slug2"]}\n`
  prompt += `Select ONLY articles likely to contain relevant information. If none are relevant, return an empty array.\n`
  prompt += `Respond ONLY with valid JSON. No markdown fences, no explanation.`
  return prompt
}

function buildAnswerPrompt(question: string, articles: Article[]): string {
  let prompt = `You are a knowledge base assistant. Answer the user's question based ONLY on the articles below. Cite which articles you used.\n\n`
  prompt += `## Question\n${question}\n\n`
  prompt += `## Articles\n`
  for (const a of articles) {
    prompt += `### ${a.slug}: ${a.title}\n${a.content}\n\n`
  }
  prompt += `## Output Format\nRespond with a JSON object:\n{"answer": "Your answer here", "sources": ["slug1", "slug2"]}\n`
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
