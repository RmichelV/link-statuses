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
  reason: string | null;
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

export function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(baseUrl);
    return a.hostname.toLowerCase() === b.hostname.toLowerCase();
  } catch {
    return false;
  }
}

export function normalizeUrl(raw: string): string | null {
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
  // Skip static assets (CSS, JS, images, fonts, etc.)
  const ext = href.split('?')[0].split('#')[0].toLowerCase();
  if (ext.endsWith('.css') || ext.endsWith('.js')) {
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

const LOGIN_DOMAINS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'tiktok.com', 'pinterest.com', 'snapchat.com', 'reddit.com',
];

function describeReason(status: number | null, errorCode: string | null, url: string): string | null {
  // 200 → no reason
  if (status === 200) return null;

  const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  const isLoginSite = LOGIN_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));

  // No response (status null) → describe by error code
  if (status === null) {
    if (!errorCode) return 'No server response';
    const code = errorCode.toUpperCase();
    if (code === 'ENOTFOUND') return 'Domain not found — DNS cannot resolve this address';
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return 'Connection timeout — server did not respond';
    if (code === 'ECONNREFUSED') return 'Connection refused — server rejected the connection on this port';
    if (code === 'ECONNRESET') return 'Connection reset — server forcibly closed the connection';
    if (code === 'ECONNABORTED') return 'Connection aborted — request timeout exceeded';
    if (code === 'ERR_BAD_REQUEST') return 'Malformed URL or invalid request';
    if (code.includes('CERT') || code.includes('TLS') || code.includes('SSL')) return 'SSL/TLS certificate error — secure connection could not be established';
    if (code === 'EHOSTUNREACH') return 'Host unreachable — cannot reach the server';
    if (code === 'ENETUNREACH') return 'Network unreachable — no route to host';
    if (code === 'ERR_FR_TOO_MANY_REDIRECTS') return 'Too many redirects — possible redirect loop';
    return `Connection error: ${errorCode}`;
  }

  // Redirects (3xx)
  if (status === 301) return 'Permanently moved to another URL';
  if (status === 302 || status === 307 || status === 308) return 'Temporarily redirected to another URL';
  if (status >= 300 && status < 400) return `Redirect (${status})`;

  // Client errors (4xx)
  if (status === 400) return 'Bad Request — server cannot understand the request';
  if (status === 401) return isLoginSite
    ? `Authentication required — ${hostname} requires login to access this content`
    : 'Authentication required — credentials not provided';
  if (status === 403) return isLoginSite
    ? `Access forbidden — ${hostname} requires login or blocks automated access`
    : 'Access forbidden — server rejected the request (possible bot blocking or insufficient permissions)';
  if (status === 404) return 'Page not found — URL does not exist on the server';
  if (status === 405) return 'Method not allowed — server does not support this HTTP method';
  if (status === 408) return 'Request timeout — server timeout exceeded';
  if (status === 410) return 'Gone — resource permanently deleted';
  if (status === 429) return 'Too many requests — server applied rate limit';
  if (status === 451) return 'Unavailable for legal reasons';
  if (status >= 400 && status < 500) return `Client error (${status})`;

  // Server errors (5xx)
  if (status === 500) return 'Internal Server Error — web application failure';
  if (status === 502) return 'Bad Gateway — proxy received invalid response';
  if (status === 503) return 'Service Unavailable — server is temporarily down or in maintenance';
  if (status === 504) return 'Gateway Timeout — proxy did not receive timely response';
  if (status >= 500) return `Server error (${status})`;

  return `Response with status ${status}`;
}

export interface RawLink {
  text: string;
  href: string;
  invalid: boolean;
}

export function extractLinks(
  html: string,
  baseUrl: string
): RawLink[] {
  const $ = cheerio.load(html);
  const links: RawLink[] = [];

  // Capturar links de cualquier elemento: <a>, <area>, <button>, o cualquier
  // elemento con href, data-href, data-url. Excluimos <link> y <base>.
  // SIN deduplicación: cada ocurrencia se reporta.
  $('[href], [data-href], [data-url]').each((_, el) => {
    const tagName = (el as any).tagName?.toLowerCase?.() ?? (el as any).name?.toLowerCase?.() ?? '';
    if (tagName === 'link' || tagName === 'base') return;

    const href = ($(el).attr('href') || $(el).attr('data-href') || $(el).attr('data-url'))?.trim();
    if (!href || !isNavigableUrl(href)) return;

    const text = $(el).text().trim() || $(el).attr('title')?.trim() || href;
    const resolved = resolveUrl(baseUrl, href);

    if (!resolved) {
      links.push({ text, href, invalid: true });
      return;
    }

    links.push({ text, href: resolved, invalid: false });
  });

  return links;
}

async function fetchAndCheck(
  client: AxiosInstance,
  link: { text: string; href: string },
  referer: string,
  delayMin: number,
  delayMax: number
): Promise<{ status: number | null; resolvedUrl: string; html: string | null; error: string | null; reason: string | null }> {
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
      reason: describeReason(res.status, null, link.href),
    };
  } catch (err: any) {
    const errorCode = err.code ?? err.message ?? 'Unknown error';
    return {
      status: null,
      resolvedUrl: link.href,
      html: null,
      error: errorCode,
      reason: describeReason(null, errorCode, link.href),
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
  const allResults: LinkResult[] = [];
  let pagesVisited = 0;

  // Cache de fetch: evita re-hacer HTTP al mismo string exacto de URL
  const fetchCache = new Map<string, { status: number | null; resolvedUrl: string; html: string | null; error: string | null; reason: string | null }>();
  // Páginas ya crawleadas para sub-links (evita loops infinitos)
  const enteredPages = new Set<string>();

  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrency);

  enteredPages.add(url);

  console.log(`\n🔍 [SCAN] Iniciando: ${url}`);
  console.log(`   Concurrencia: ${concurrency} | Delay: ${delayMin}-${delayMax}ms | Profundidad: ${maxDepth}`);
  console.log(`   Cargando página raíz...`);

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

  const rootLinks = extractLinks(rootHtml, url);
  console.log(`   ✅ Página raíz cargada: "${pageTitle}"`);
  console.log(`   🔗 Links encontrados en raíz: ${rootLinks.length}\n`);

  const shuffledRoot = shuffleArray(rootLinks);

  // Identificar URLs únicas a fetchear (string exacto) para no repetir requests
  const uniqueDepth1Hrefs = [...new Set(shuffledRoot.filter(l => !l.invalid).map(l => l.href))];
  console.log(`📡 [Depth 1] Fetching ${uniqueDepth1Hrefs.length} URLs únicas (${shuffledRoot.length} ocurrencias totales)...`);
  let d1Done = 0;

  // Fetch todas las URLs únicas
  await Promise.all(
    uniqueDepth1Hrefs.map((href) =>
      limit(async () => {
        const result = await fetchAndCheck(client, { text: '', href }, url, delayMin, delayMax);
        fetchCache.set(href, result);
        d1Done++;
        const icon = result.status === null ? '❌' : result.status >= 400 ? '⚠️' : '✅';
        console.log(`   ${icon} [${d1Done}/${uniqueDepth1Hrefs.length}] ${result.status ?? 'NULL'} → ${href}`);
      })
    )
  );

  const depth2Queue: { href: string; html: string; parentUrl: string }[] = [];

  // Reportar CADA ocurrencia (sin dedup)
  for (const link of shuffledRoot) {
    if (link.invalid) {
      allResults.push({
        text: link.text,
        href: link.href,
        resolvedUrl: link.href,
        status: null,
        reason: 'Invalid URL — could not resolve the address',
        error: 'Invalid URL',
        foundOn: url,
        depth: 1,
      });
      continue;
    }

    const cached = fetchCache.get(link.href)!;
    allResults.push({
      text: link.text,
      href: link.href,
      resolvedUrl: cached.resolvedUrl,
      status: cached.status,
      reason: cached.reason,
      error: cached.error,
      foundOn: url,
      depth: 1,
    });

    // Encolar para depth 2 solo si es interno, HTML válido, y no se entró antes
    const isInternal = isSameDomain(link.href, url);
    if (
      isInternal &&
      cached.html &&
      cached.status !== null &&
      cached.status < 400 &&
      maxDepth >= 2 &&
      !enteredPages.has(cached.resolvedUrl)
    ) {
      enteredPages.add(cached.resolvedUrl);
      pagesVisited++;
      depth2Queue.push({ href: link.href, html: cached.html, parentUrl: cached.resolvedUrl });
    }
  }

  if (maxDepth >= 2) {
    console.log(`\n📄 [Depth 2] ${depth2Queue.length} páginas internas por analizar...`);
    let pageIdx = 0;
    for (const page of depth2Queue) {
      pageIdx++;
      const subLinks = extractLinks(page.html, page.parentUrl);

      // Identificar URLs únicas a fetchear en este nivel
      const uniqueSubHrefs = [...new Set(
        subLinks.filter(l => !l.invalid).map(l => l.href).filter(h => !fetchCache.has(h))
      )];
      console.log(`\n   📄 [${pageIdx}/${depth2Queue.length}] ${page.parentUrl}`);
      console.log(`      Links: ${subLinks.length} | Nuevas URLs a fetchear: ${uniqueSubHrefs.length}`);
      let d2Done = 0;

      await Promise.all(
        uniqueSubHrefs.map((href) =>
          limit(async () => {
            const result = await fetchAndCheck(client, { text: '', href }, page.parentUrl, delayMin, delayMax);
            fetchCache.set(href, result);
            d2Done++;
            const icon = result.status === null ? '❌' : result.status >= 400 ? '⚠️' : '✅';
            console.log(`      ${icon} [${d2Done}/${uniqueSubHrefs.length}] ${result.status ?? 'NULL'} → ${href}`);
          })
        )
      );

      for (const sl of subLinks) {
        if (sl.invalid) {
          allResults.push({
            text: sl.text,
            href: sl.href,
            resolvedUrl: sl.href,
            status: null,
            reason: 'Invalid URL — could not resolve the address',
            error: 'Invalid URL',
            foundOn: page.href,
            depth: 2,
          });
          continue;
        }

        const cached = fetchCache.get(sl.href)!;
        allResults.push({
          text: sl.text,
          href: sl.href,
          resolvedUrl: cached.resolvedUrl,
          status: cached.status,
          reason: cached.reason,
          error: cached.error,
          foundOn: page.href,
          depth: 2,
        });
      }
    }
  }

  sortErrorsFirst(allResults);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const errors = allResults.filter(r => r.status === null || (r.status !== null && r.status >= 400)).length;
  console.log(`\n✅ [SCAN COMPLETADO] ${elapsed}s`);
  console.log(`   Total links: ${allResults.length} | Errores/4xx: ${errors} | Páginas visitadas: ${pagesVisited}\n`);

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
