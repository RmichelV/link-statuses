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

export interface SubPageResult {
  navLinkText: string;
  navLinkHref: string;
  pageTitle: string;
  links: SectionLink[];
}

export interface ScanResult {
  url: string;
  pageTitle: string;
  sections: SectionResult[];
  subPages: SubPageResult[];
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

// ─── PAQ-style cleanup selectors ─────────────────────────

const CLEANUP_SELECTORS = [
  // Inventory / search / forms
  "[data-name^='inventory-search-results-page-filters-sort-']",
  "[data-name^='inventory-search-results-facets-']",
  '#inventory-results1-app-root',
  '#inventory-search1-app-root',
  '#inventory-filters1-app-root',
  '#inventory-facets1-app-root',
  '#kbb-leaddriver-search',
  "[data-name^='form-centered']",
  "[data-widget-name='contact-form']",
  "[data-name^='map-hours']",
  "[data-name='map-1']",
  "[data-widget-name='map-dynamic']",
  '.facetmulti.BLANK',
  '#compareForm',
  '.ws-inv-text-search',
  '.ws-inv-filters',
  '.ws-inv-facets',
  '.srp-wrapper-facets',
  // Header / footer / nav / banners / chat
  'header', 'footer',
  '.global-header', '.global-footer',
  '.site-header', '.site-footer',
  '.ddc-header', '.ddc-footer',
  'nav', '.primary-nav', '.site-nav', '.header-navigation',
  '.breadcrumbs', '.bread-crumbs', '.topbar', '.sitewide-bar',
  '.cookie-banner', '#onetrust-banner-sdk',
  '[role="dialog"][aria-label*="cookie"]',
  '.notification-banner', '.promo-banner',
  '[data-widget-name="chat"]', '.chat-widget',
  '.ws-hours', '.ws-social', '.ws-share',
];

/**
 * Limpieza estilo paq: aisla .ddc-wrapper, elimina todos los selectores de
 * UI/nav/footer/inventario/chat, y devuelve los <a href> que quedan.
 */
function extractCleanedLinks(
  html: string,
  baseUrl: string,
): SectionLink[] {
  const $ = cheerio.load(html);
  const wrapper = $('.ddc-wrapper');
  if (wrapper.length === 0) return [];

  // Remove all cleanup selectors inside the wrapper
  for (const sel of CLEANUP_SELECTORS) {
    wrapper.find(sel).remove();
  }

  // Extract remaining links from the cleaned wrapper
  const links: SectionLink[] = [];
  wrapper.find('a[href]').each((_, el) => {
    const $el = $(el);
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

// ─── Section definitions ─────────────────────────────────

const SECTION_DEFS: { name: string; selector: string; exclude?: string[] }[] = [
  { name: 'Navigation', selector: '.header-navigation' },
  { name: 'Footer', selector: '.ddc-footer' },
  { name: 'DDC Wrapper', selector: '.ddc-wrapper', exclude: ['.header-navigation', '.ddc-footer'] },
];

/** Extract links from all 3 sections of a parsed HTML page */
function extractAllSections($: cheerio.CheerioAPI, baseUrl: string): SectionResult[] {
  const sections: SectionResult[] = [];
  for (const def of SECTION_DEFS) {
    let selectorToUse = def.selector;
    if (def.name === 'Navigation' && $(def.selector).length === 0 && $('.navbar-nav').length > 0) {
      selectorToUse = '.navbar-nav';
      console.log(`      ℹ️  "${def.name}" fallback selector in use (${selectorToUse})`);
    }

    const links = extractLinksFromSection($, selectorToUse, baseUrl, def.exclude);
    if ($(selectorToUse).length === 0) {
      console.log(`      ⚠️  "${def.name}" not found (${def.selector})`);
    } else {
      console.log(`      📦 ${def.name}: ${links.length} links`);
    }
    sections.push({ section: def.name, links });
  }
  return sections;
}

/** Check HTTP status of every unique URL across all sections, using a shared cache */
async function resolveStatuses(
  sections: SectionResult[],
  statusCache: Map<string, { status: number | null; error: string | null; reason: string | null }>,
  client: AxiosInstance,
  referer: string,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  delayMin: number,
  delayMax: number,
): Promise<void> {
  const allLinks = sections.flatMap(s => s.links);
  const newUrls = [...new Set(allLinks.map(l => l.href))].filter(u => !statusCache.has(u));

  if (newUrls.length > 0) {
    let done = 0;
    await Promise.all(
      newUrls.map(href =>
        limit(async () => {
          const result = await checkStatus(client, href, referer, delayMin, delayMax);
          statusCache.set(href, result);
          done++;
          const icon = result.status === null ? '❌' : result.status >= 400 ? '⚠️' : '✅';
          console.log(`      ${icon} [${done}/${newUrls.length}] ${result.status ?? 'ERR'} → ${href}`);
        }),
      ),
    );
  }

  // Apply cached statuses
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
}

/** Check HTTP status for a flat array of links, using shared cache */
async function resolveStatusesFlat(
  links: SectionLink[],
  statusCache: Map<string, { status: number | null; error: string | null; reason: string | null }>,
  client: AxiosInstance,
  referer: string,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  delayMin: number,
  delayMax: number,
): Promise<void> {
  const newUrls = [...new Set(links.map(l => l.href))].filter(u => !statusCache.has(u));

  if (newUrls.length > 0) {
    let done = 0;
    await Promise.all(
      newUrls.map(href =>
        limit(async () => {
          const result = await checkStatus(client, href, referer, delayMin, delayMax);
          statusCache.set(href, result);
          done++;
          const icon = result.status === null ? '❌' : result.status >= 400 ? '⚠️' : '✅';
          console.log(`      ${icon} [${done}/${newUrls.length}] ${result.status ?? 'ERR'} → ${href}`);
        }),
      ),
    );
  }

  for (const link of links) {
    const cached = statusCache.get(link.href);
    if (cached) {
      link.status = cached.status;
      link.error = cached.error;
      link.reason = cached.reason;
    }
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

  // Shared status cache across home + all sub-pages
  const statusCache = new Map<string, { status: number | null; error: string | null; reason: string | null }>();

  console.log(`\n🔍 [SCAN] Starting: ${url}`);
  console.log(`   Concurrency: ${concurrency} | Delay: ${delayMin}-${delayMax}ms`);

  // ── HOME PAGE ──────────────────────────────
  const pageRes = await client.get(url, {
    headers: buildBrowserHeaders(),
    responseType: 'text',
  });
  const html = typeof pageRes.data === 'string' ? pageRes.data : String(pageRes.data);
  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().trim() || '(no title)';

  console.log(`   ✅ Home loaded: "${pageTitle}"`);
  console.log(`   📄 Extracting home sections...`);

  const sections = extractAllSections($, url);

  console.log(`\n📡 Checking home URLs...`);
  await resolveStatuses(sections, statusCache, client, url, limit, delayMin, delayMax);

  // ── SUB-PAGES (visit each nav link) ────────
  const navSection = sections.find(s => s.section === 'Navigation');
  const navLinks = navSection?.links ?? [];
  const subPages: SubPageResult[] = [];

  // Deduplicate nav links by href (keep first occurrence text)
  const visitedNavHrefs = new Set<string>();

  console.log(`\n📂 [SUB-PAGES] Visiting ${navLinks.length} nav links...`);

  for (let i = 0; i < navLinks.length; i++) {
    const navLink = navLinks[i];

    // Skip already visited or same as home
    if (visitedNavHrefs.has(navLink.href)) continue;
    if (navLink.href === url) continue;
    visitedNavHrefs.add(navLink.href);

    console.log(`\n   🔗 [${i + 1}/${navLinks.length}] "${navLink.text}" → ${navLink.href}`);

    try {
      const subRes = await client.get(navLink.href, {
        headers: buildBrowserHeaders(url),
        responseType: 'text',
        timeout: 15_000,
      });
      const subHtml = typeof subRes.data === 'string' ? subRes.data : String(subRes.data);
      const sub$ = cheerio.load(subHtml);
      const subTitle = sub$('title').first().text().trim() || '(no title)';

      console.log(`      ✅ Loaded: "${subTitle}"`);
      console.log(`      🧹 Cleaning (isolate .ddc-wrapper, remove UI elements)...`);

      const cleanedLinks = extractCleanedLinks(subHtml, navLink.href);
      console.log(`      📦 Links after cleanup: ${cleanedLinks.length}`);

      console.log(`      📡 Checking URLs...`);
      await resolveStatusesFlat(cleanedLinks, statusCache, client, navLink.href, limit, delayMin, delayMax);

      subPages.push({
        navLinkText: navLink.text,
        navLinkHref: navLink.href,
        pageTitle: subTitle,
        links: cleanedLinks,
      });
    } catch (err: any) {
      console.log(`      ❌ Failed to load: ${err.code ?? err.message}`);
      subPages.push({
        navLinkText: navLink.text,
        navLinkHref: navLink.href,
        pageTitle: '(failed to load)',
        links: [],
      });
    }
  }

  // ── Summary ────────────────────────────────
  const homeLinks = sections.flatMap(s => s.links).length;
  const subLinksTotal = subPages.reduce((sum, p) => sum + p.links.length, 0);
  const totalLinks = homeLinks + subLinksTotal;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n✅ [SCAN COMPLETE] ${elapsed}s`);
  console.log(`   Home links: ${homeLinks} | Sub-page links: ${subLinksTotal} | Total: ${totalLinks}\n`);

  return {
    url,
    pageTitle,
    sections,
    subPages,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    totalLinks,
  };
}
