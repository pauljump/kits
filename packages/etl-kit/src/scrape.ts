import * as cheerio from 'cheerio'
import { fetchWithRetry } from './retry.js'
import type { FetchOptions } from './types.js'

/**
 * Fetch a URL and parse the HTML with cheerio.
 * Returns the cheerio root ($) for DOM querying.
 *
 * Usage:
 *   const $ = await scrapeHTML('https://example.com')
 *   const titles = $('h1').map((_, el) => $(el).text()).get()
 */
export async function scrapeHTML(
  url: string,
  options: Omit<FetchOptions, 'body' | 'method'> = {}
): Promise<cheerio.CheerioAPI> {
  const response = await fetchWithRetry(url, {
    ...options,
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; etl-kit/0.1)',
      ...options.headers,
    },
  })

  const html = await response.text()
  return cheerio.load(html)
}
