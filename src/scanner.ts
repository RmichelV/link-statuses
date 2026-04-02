import axios from 'axios';
import https from 'https';
import http from 'http';
import * as cheerio from 'cheerio';
import { buildBrowserHeaders, randomDelay, shuffleArray } from './stealth';

export interface LinkResult {
  text: string;
  href: string;
  resolvedUrl: string;
  status: number | null;
  error: string | null;
}

export interface ScanResult {
  url: string;
  pageTitle: string;
  totalLinks: number;
  links: LinkResult[];
  scannedAt: string;
  durationMs: number;
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const httpAgent = new http.Agent({ keepAlive: true });

function createClient() {
  return axios.create({
    timeout: 15_000,
    maxRedirects: 5,
    validateStatus: () => true,
    httpsAgent,
    httpAgent,
  });
}

function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function isNavigableUrl(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }
  return true;
}

export async function scanPage(
  url: string,
  concurrency = 5,
  delayMin = 300,
  delayMax = 1500
): Promise<ScanResult> {
  const start = Date.now();
  const client = createClient();

  const pageResponse = await client.get(url, {
    headers: buildBrowserHeaders(),
    responseType: 'text',
  });

  const html: string = typeof pageResponse.data === 'string'
    ? pageResponse.data
    : String(pageResponse.data);

  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().trim() || '(sin título)';

  const rawLinks: { text: string; href: string }[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href || !isNavigableUrl(href)) return;

    const resolved = resolveUrl(url, href);
    if (!resolved) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);

    const text = $(el).text().trim() || $(el).attr('title')?.trim() || resolved;
    rawLinks.push({ text, href: resolved });
  });

  const shuffled = shuffleArray(rawLinks);

  // Dynamic import for p-limit (ESM module)
  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrency);

  const results: LinkResult[] = await Promise.all(
    shuffled.map((link) =>
      limit(async (): Promise<LinkResult> => {
        await randomDelay(delayMin, delayMax);
        try {
          const res = await client.get(link.href, {
            headers: buildBrowserHeaders(url),
            maxRedirects: 5,
            timeout: 12_000,
            validateStatus: () => true,
          });
          return {
            text: link.text,
            href: link.href,
            resolvedUrl: res.request?.res?.responseUrl ?? link.href,
            status: res.status,
            error: null,
          };
        } catch (err: any) {
          return {
            text: link.text,
            href: link.href,
            resolvedUrl: link.href,
            status: null,
            error: err.code ?? err.message ?? 'Unknown error',
          };
        }
      })
    )
  );

  results.sort((a, b) => a.text.localeCompare(b.text));

  return {
    url,
    pageTitle,
    totalLinks: results.length,
    links: results,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
