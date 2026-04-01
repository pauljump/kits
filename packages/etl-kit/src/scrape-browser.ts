import type { CheerioAPI } from 'cheerio'
import * as cheerio from 'cheerio'

// Puppeteer is an optional peer dependency — only imported when these functions are called.
// This keeps etl-kit light for tenants that only use cheerio-based scrapeHTML().

type PuppeteerBrowser = import('puppeteer').Browser
type PuppeteerPage = import('puppeteer').Page
type PuppeteerWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Options for scrapeBrowser */
export interface ScrapeBrowserOptions {
  /** Puppeteer waitUntil event. Defaults to 'networkidle2'. */
  waitUntil?: PuppeteerWaitUntil
  /** Extra ms to wait after page load for JS to settle. Defaults to 0. */
  waitMs?: number
  /** Navigation timeout in ms. Defaults to 30000. */
  timeoutMs?: number
  /** User-Agent header. Defaults to a recent Chrome UA. */
  userAgent?: string
  /** Optional function to run in page context before extracting HTML. */
  beforeExtract?: (page: PuppeteerPage) => Promise<void>
}

/** Options for scrapeBatch */
export interface ScrapeBatchOptions {
  /** Max concurrent pages. Defaults to 5. */
  concurrency?: number
  /** Delay in ms between batches. Defaults to 500. */
  delayMs?: number
  /** Navigation timeout per page in ms. Defaults to 30000. */
  timeoutMs?: number
  /** Puppeteer waitUntil event. Defaults to 'networkidle2'. */
  waitUntil?: PuppeteerWaitUntil
  /** Extra ms to wait after each page load. Defaults to 0. */
  waitMs?: number
  /** User-Agent header. */
  userAgent?: string
  /** Puppeteer launch args. Defaults to ['--no-sandbox']. */
  launchArgs?: string[]
  /** Called after each item completes. */
  onProgress?: (completed: number, total: number) => void
}

async function launchBrowser(args: string[] = ['--no-sandbox']): Promise<PuppeteerBrowser> {
  // Dynamic import so puppeteer is only loaded when needed
  const puppeteer = await import('puppeteer')
  return puppeteer.launch({ headless: true, args })
}

async function setupPage(
  browser: PuppeteerBrowser,
  options: { userAgent?: string; timeoutMs?: number },
): Promise<PuppeteerPage> {
  const page = await browser.newPage()
  await page.setUserAgent(options.userAgent ?? DEFAULT_USER_AGENT)
  page.setDefaultNavigationTimeout(options.timeoutMs ?? 30_000)
  return page
}

/**
 * Scrape a JS-rendered page using Puppeteer and return a cheerio instance.
 *
 * Same mental model as scrapeHTML() — returns $ for DOM querying —
 * but launches a real browser to render JavaScript first.
 *
 * Usage:
 *   const $ = await scrapeBrowser('https://example.com/spa')
 *   const titles = $('h1').map((_, el) => $(el).text()).get()
 */
export async function scrapeBrowser(
  url: string,
  options: ScrapeBrowserOptions = {},
): Promise<CheerioAPI> {
  const {
    waitUntil = 'networkidle2',
    waitMs = 0,
    timeoutMs = 30_000,
    userAgent,
    beforeExtract,
  } = options

  const browser = await launchBrowser()
  try {
    const page = await setupPage(browser, { userAgent, timeoutMs })
    await page.goto(url, { waitUntil, timeout: timeoutMs })

    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs))
    }

    if (beforeExtract) {
      await beforeExtract(page)
    }

    const html = await page.content()
    return cheerio.load(html)
  } finally {
    await browser.close()
  }
}

/**
 * Scrape multiple URLs concurrently using a shared browser instance.
 *
 * Manages page lifecycle, concurrency, polite delays, and progress reporting.
 * The scraper function gets full page access for complex extraction logic.
 *
 * Usage:
 *   const results = await scrapeBatch(
 *     urls,
 *     async (page, url) => {
 *       await page.goto(url, { waitUntil: 'networkidle2' })
 *       return page.evaluate(() => document.title)
 *     },
 *     { concurrency: 5, delayMs: 500 }
 *   )
 */
export async function scrapeBatch<T>(
  items: string[],
  scraper: (page: PuppeteerPage, url: string, index: number) => Promise<T>,
  options: ScrapeBatchOptions = {},
): Promise<T[]> {
  const {
    concurrency = 5,
    delayMs = 500,
    timeoutMs = 30_000,
    userAgent,
    launchArgs,
    onProgress,
  } = options

  const browser = await launchBrowser(launchArgs)
  const results: T[] = []

  try {
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency)

      const batchResults = await Promise.all(
        batch.map(async (url, batchIdx) => {
          const page = await setupPage(browser, { userAgent, timeoutMs })
          try {
            return await scraper(page, url, i + batchIdx)
          } finally {
            await page.close()
          }
        }),
      )

      results.push(...batchResults)

      if (onProgress) {
        onProgress(results.length, items.length)
      }

      // Polite delay between batches (skip after last batch)
      if (i + concurrency < items.length && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }

    return results
  } finally {
    await browser.close()
  }
}
