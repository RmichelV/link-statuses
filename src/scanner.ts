import axios, { AxiosInstance } from 'axios';
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
  foundOn: string;
  depth: number;
}

export interface ScanResult {
  url: string;
  pageTitle: string;
  totalLinks: number;
  links: LinkResult[];
  scannedAt: string;
  durationMs: number;
  maxDepth: number;
  pagesVisited: number;
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

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = '';
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}${u.pathname}${u.search}`;
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

function sortErrorsFirst(results: LinkResult[]): void {
  results.sort((a, b) => {
    const priorityA = a.status === null ? 0 : a.status >= 400 ? 1 : 2;
    const priorityB = b.status === null ? 0 : b.status >= 400 ? 1 : 2;
    if (priorityA !== priorityB) return priorityA - priorityB;
    if (priorityA === 1 && priorityB === 1) return (b.status ?? 0) - (a.status ?? 0);
    return a.text.localeCompare(b.text);
  });
}

function extractLinks(
  html: string,
  baseUrl: string,
  visited: Set<string>
): { text: string; href: string; normalized: string }[] {
  const $ = cheerio.load(html);
  const links: { text: string; href: string; normalized: string }[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href || !isNavigableUrl(href)) return;

    const resolved = resolveUrl(baseUrl, href);
    if (!resolved) return;

    const normalized = normalizeUrl(resolved);
    if (!normalized) return;
    if (visited.has(normalized)) return;

    const text = $(el).text().trim() || $(el).attr('title')?.trim() || resolved;
    links.push({ text, href: resolved, normalized });
  });

  return links;
}

async function fetchAndCheck(
  client: AxiosInstance,
  link: { text: string; href: string },
  referer: string,
  delayMin: number,
  delayMax: number
): Promise<{ status: number | null; resolvedUrl: string; html: string | null; error: string | null }> {
  await randomDelay(delayMin, delayMax);
  try {
    const res = await client.get(link.href, {
      headers: buildBrowserHeaders(referer),
      maxRedirects: 5,
      timeout: 12_000,
      validateStatus: () => true,
      responseType: 'text',
    });
    const contentType: string = res.headers['content-type'] ?? '';
    const isHtml = contentType.includes('text/html');
    const body = typeof res.data === 'string' ? res.data : String(res.data);
    return {
      status: res.status,
      resolvedUrl: res.request?.res?.responseUrl ?? link.href,
      html: isHtml ? body : null,
      error: null,
    };
  } catch (err: any) {
    return {
      status: null,
      resolvedUrl: link.href,
      html: null,
      error: err.code ?? err.message ?? 'Unknown error',
    };
  }
}

export async function scanPage(
  url: string,
  concurrency = 5,
  delayMin = 300,
  delayMax = 1500,
  maxDepth = 2
): Promise<ScanResult> {
  const start = Date.now();
  const client = createClient();
  const visited = new Set<string>();
  const allResults: LinkResult[] = [];
  let pagesVisited = 0;

  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrency);

  const rootNorm = normalizeUrl(url);
  if (rootNorm) visited.add(rootNorm);

  const pageResponse = await client.get(url, {
    headers: buildBrowserHeaders(),
    responseType: 'text',
  });

  const rootHtml: string = typeof pageResponse.data === 'string'
    ? pageResponse.data
    : String(pageResponse.data);

  const $ = cheerio.load(rootHtml);
  const pageTitle = $('title').first().text().trim() || '(sin título)';
  pagesVisited++;

  const rootLinks = extractLinks(rootHtml, url, visited);
  for (const link of rootLinks) {
    visited.add(link.normalized);
  }
  const shuffledRoot = shuffleArray(rootLinks);

  const depth1Results = await Promise.all(
    shuffledRoot.map((link) =>
      limit(async () => {
        const result = await fetchAndCheck(client, link, url, delayMin, delayMax);
        return { link, result };
      })
    )
  );

  const depth2Queue: { text: string; href: string; html: string; parentUrl: string }[] = [];

  for (const { link, result } of depth1Results) {
    allResults.push({
      text: link.text,
      href: link.href,
      resolvedUrl: result.resolvedUrl,
      status: result.status,
      error: result.error,
      foundOn: url,
      depth: 1,
    });
    if (result.html && result.status !== null && result.status < 400 && maxDepth >= 2) {
      pagesVisited++;
      depth2Queue.push({ text: link.text, href: link.href, html: result.html, parentUrl: result.resolvedUrl });
    }
  }

  if (maxDepth >= 2) {
    for (const page of depth2Queue) {
      const subLinks = extractLinks(page.html, page.parentUrl, visited);
      for (const sl of subLinks) {
        visited.add(sl.normalized);
      }
      const shuffledSub = shuffleArray(subLinks);

      const depth2Results = await Promise.all(
        shuffledSub.map((sl) =>
          limit(async () => {
            const result = await fetchAndCheck(client, sl, page.parentUrl, delayMin, delayMax);
            return { sl, result };
          })
        )
      );

      for (const { sl, result } of depth2Results) {
        allResults.push({
          text: sl.text,
          href: sl.href,
          resolvedUrl: result.resolvedUrl,
          status: result.status,
          error: result.error,
          foundOn: page.href,
          depth: 2,
        });
      }
    }
  }

  sortErrorsFirst(allResults);

  return {
    url,
    pageTitle,
    totalLinks: allResults.length,
    links: allResults,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    maxDepth,
    pagesVisited,
  };
}
