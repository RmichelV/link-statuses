import axios, { AxiosInstance } from 'axios';
import https from 'https';
import http from 'http';
import * as cheerio from 'cheerio';
import { buildBrowserHeaders, randomDelay } from './stealth';

// ─── Interfaces ──────────────────────────────────────────

export interface SectionLink {
  text: string;
  href: string;
  status: number | null;
  reason: string | null;
  error: string | null;
}

export interface SectionResult {
  section: string;
  links: SectionLink[];
}

export interface ScanResult {
  url: string;
  pageTitle: string;
  sections: SectionResult[];
  scannedAt: string;
  durationMs: number;
  totalLinks: number;
}

// ─── HTTP client ─────────────────────────────────────────

const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const httpAgent = new http.Agent({ keepAlive: true });

function createClient(): AxiosInstance {
  return axios.create({
    timeout: 15_000,
    maxRedirects: 5,
    validateStatus: () => true,
    httpsAgent,
    httpAgent,
  });
}

// ─── URL helpers ─────────────────────────────────────────

/** Solo completa URLs relativas con la base. Las absolutas se dejan intactas. */
function resolveHref(base: string, rawHref: string): string {
  if (/^https?:\/\//i.test(rawHref)) return rawHref;
  try { return new URL(rawHref, base).href; } catch { return rawHref; }
}

function isNavigableUrl(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
      href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  const ext = href.split('?')[0].split('#')[0].toLowerCase();
  if (ext.endsWith('.css') || ext.endsWith('.js')) return false;
  return true;
}

// ─── Reason descriptions ─────────────────────────────────

const LOGIN_DOMAINS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'tiktok.com', 'pinterest.com', 'snapchat.com', 'reddit.com',
];

function describeReason(status: number | null, errorCode: string | null, url: string): string | null {
  if (status === 200) return null;

  const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  const isLoginSite = LOGIN_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));

  if (status === null) {
    if (!errorCode) return 'No server response';
    const code = errorCode.toUpperCase();
    if (code === 'ENOTFOUND') return 'Domain not found — DNS cannot resolve this address';
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return 'Connection timeout — server did not respond';
    if (code === 'ECONNREFUSED') return 'Connection refused — server rejected the connection';
    if (code === 'ECONNRESET') return 'Connection reset — server forcibly closed the connection';
    if (code === 'ECONNABORTED') return 'Connection aborted — request timeout exceeded';
    if (code === 'ERR_BAD_REQUEST') return 'Malformed URL or invalid request';
    if (code.includes('CERT') || code.includes('TLS') || code.includes('SSL'))
      return 'SSL/TLS certificate error — secure connection could not be established';
    if (code === 'EHOSTUNREACH') return 'Host unreachable — cannot reach the server';
    if (code === 'ENETUNREACH') return 'Network unreachable — no route to host';
    if (code === 'ERR_FR_TOO_MANY_REDIRECTS') return 'Too many redirects — possible redirect loop';
    return `Connection error: ${errorCode}`;
  }

  if (status === 301) return 'Permanently moved to another URL';
  if (status === 302 || status === 307 || status === 308) return 'Temporarily redirected';
  if (status >= 300 && status < 400) return `Redirect (${status})`;

  if (status === 400) return 'Bad Request — server cannot understand the request';
  if (status === 401) return isLoginSite
    ? `Authentication required — ${hostname} requires login`
    : 'Authentication required — credentials not provided';
  if (status === 403) return isLoginSite
    ? `Access forbidden — ${hostname} blocks automated access`
    : 'Access forbidden — server rejected the request';
  if (status === 404) return 'Page not found — URL does not exist on the server';
  if (status === 405) return 'Method not allowed';
  if (status === 408) return 'Request timeout';
  if (status === 410) return 'Gone — resource permanently deleted';
  if (status === 429) return 'Too many requests — rate limit applied';
  if (status === 451) return 'Unavailable for legal reasons';
  if (status >= 400 && status < 500) return `Client error (${status})`;

  if (status === 500) return 'Internal Server Error';
  if (status === 502) return 'Bad Gateway';
  if (status === 503) return 'Service Unavailable — server is temporarily down';
  if (status === 504) return 'Gateway Timeout';
  if (status >= 500) return `Server error (${status})`;

  return `Response with status ${status}`;
}

// ─── Section link extraction ─────────────────────────────

/**
 * Extrae todos los <a href> visibles dentro del contenedor indicado.
 * `excludeSelectors` permite ignorar links que estén dentro de sub-contenedores
 * (ej: excluir nav y footer cuando se lee .ddc-wrapper).
 */
function extractLinksFromSection(
  $: cheerio.CheerioAPI,
  selector: string,
  baseUrl: string,
  excludeSelectors: string[] = [],
): SectionLink[] {
  const links: SectionLink[] = [];
  const container = $(selector);
  if (container.length === 0) return links;

  container.find('a[href]').each((_, el) => {
    const $el = $(el);
    for (const exc of excludeSelectors) {
      if ($el.closest(exc).length > 0) return;
    }

    const rawHref = $el.attr('href')?.trim();
    if (!rawHref || !isNavigableUrl(rawHref)) return;

    const text = $el.text().trim() || $el.attr('title')?.trim() || rawHref;
    const href = resolveHref(baseUrl, rawHref);

    links.push({ text, href, status: null, reason: null, error: null });
  });

  return links;
}

// ─── HTTP status check ───────────────────────────────────

async function checkStatus(
  client: AxiosInstance,
  href: string,
  referer: string,
  delayMin: number,
  delayMax: number,
): Promise<{ status: number | null; error: string | null; reason: string | null }> {
  await randomDelay(delayMin, delayMax);
  try {
    const res = await client.get(href, {
      headers: buildBrowserHeaders(referer),
      maxRedirects: 5,
      timeout: 12_000,
      validateStatus: () => true,
    });
    return { status: res.status, error: null, reason: describeReason(res.status, null, href) };
  } catch (err: any) {
    const errorCode = err.code ?? err.message ?? 'Unknown error';
    return { status: null, error: errorCode, reason: describeReason(null, errorCode, href) };
  }
}

// ─── Main scan ───────────────────────────────────────────

export async function scanPage(
  url: string,
  concurrency = 5,
  delayMin = 300,
  delayMax = 1500,
): Promise<ScanResult> {
  const start = Date.now();
  const client = createClient();

  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrency);

  console.log(`\n🔍 [SCAN] Starting: ${url}`);
  console.log(`   Concurrency: ${concurrency} | Delay: ${delayMin}-${delayMax}ms`);

  // Fetch main page
  const pageRes = await client.get(url, {
    headers: buildBrowserHeaders(),
    responseType: 'text',
  });
  const html = typeof pageRes.data === 'string' ? pageRes.data : String(pageRes.data);
  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().trim() || '(no title)';

  console.log(`   ✅ Page loaded: "${pageTitle}"`);

  // Define sections to analyze
  const sectionDefs: { name: string; selector: string; exclude?: string[] }[] = [
    { name: 'Navigation', selector: '.header-navigation' },
    { name: 'Footer', selector: '.ddc-footer' },
    { name: 'DDC Wrapper', selector: '.ddc-wrapper', exclude: ['.header-navigation', '.ddc-footer'] },
  ];

  const sections: SectionResult[] = [];

  for (const def of sectionDefs) {
    const links = extractLinksFromSection($, def.selector, url, def.exclude);
    if ($(def.selector).length === 0) {
      console.log(`   ⚠️  "${def.name}" not found (${def.selector})`);
    } else {
      console.log(`   📦 ${def.name}: ${links.length} links`);
    }
    sections.push({ section: def.name, links });
  }

  // Collect unique URLs across all sections and check HTTP statuses
  const allLinks = sections.flatMap(s => s.links);
  const uniqueUrls = [...new Set(allLinks.map(l => l.href))];

  console.log(`\n📡 Checking ${uniqueUrls.length} unique URLs...`);

  const statusCache = new Map<string, { status: number | null; error: string | null; reason: string | null }>();
  let done = 0;

  await Promise.all(
    uniqueUrls.map(href =>
      limit(async () => {
        const result = await checkStatus(client, href, url, delayMin, delayMax);
        statusCache.set(href, result);
        done++;
        const icon = result.status === null ? '❌' : result.status >= 400 ? '⚠️' : '✅';
        console.log(`   ${icon} [${done}/${uniqueUrls.length}] ${result.status ?? 'ERR'} → ${href}`);
      }),
    ),
  );

  // Apply cached statuses to every link
  for (const section of sections) {
    for (const link of section.links) {
      const cached = statusCache.get(link.href);
      if (cached) {
        link.status = cached.status;
        link.error = cached.error;
        link.reason = cached.reason;
      }
    }
  }

  const totalLinks = allLinks.length;
  const errors = allLinks.filter(l => l.status === null || (l.status !== null && l.status >= 400)).length;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n✅ [SCAN COMPLETE] ${elapsed}s`);
  console.log(`   Total links: ${totalLinks} | Errors: ${errors}\n`);

  return {
    url,
    pageTitle,
    sections,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    totalLinks,
  };
}
