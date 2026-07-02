import ExcelJS from 'exceljs';
import { ScanResult, SectionResult, SectionLink } from './scanner';

const COLOR_HEADER_BG = '2B579A';
const COLOR_HEADER_FG = 'FFFFFF';
const COLOR_ERROR_BG  = 'FDECEA';
const COLOR_ERROR_FG  = 'C0392B';
const COLOR_WARN_FG   = 'CC6600';
const COLOR_OK_FG     = '1E7E34';
const COLOR_ROW_ALT   = 'F0F7FF';
const COLOR_SECTION_BG = '3B3B3B';

const solidFill = (color: string): ExcelJS.Fill => ({
  type: 'pattern', pattern: 'solid', fgColor: { argb: color },
});

const headerFont = (color: string, size = 11, bold = true): Partial<ExcelJS.Font> => ({
  bold, color: { argb: color }, size,
});

// ─── Column definitions shared everywhere ────────────────
const COL_DEFS = [
  { header: 'Link Text',   width: 40 },
  { header: 'URL',         width: 70 },
  { header: 'HTTP Status', width: 14 },
  { header: 'Reason',      width: 50 },
];

/** Write grouped sections (Navigation / Footer / DDC Wrapper) into a worksheet */
function writeSectionsToSheet(ws: ExcelJS.Worksheet, sections: SectionResult[]): void {
  // Set column widths
  COL_DEFS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  let currentRow = 1;

  for (const section of sections) {
    // ── Section header ──
    ws.mergeCells(currentRow, 1, currentRow, COL_DEFS.length);
    const secCell = ws.getCell(currentRow, 1);
    secCell.value = `📦 ${section.section}  (${section.links.length} links)`;
    secCell.fill  = solidFill(COLOR_SECTION_BG);
    secCell.font  = headerFont(COLOR_HEADER_FG, 12);
    secCell.alignment = { vertical: 'middle' };
    ws.getRow(currentRow).height = 24;
    currentRow++;

    if (section.links.length === 0) {
      ws.mergeCells(currentRow, 1, currentRow, COL_DEFS.length);
      const emptyCell = ws.getCell(currentRow, 1);
      emptyCell.value = '(no links found)';
      emptyCell.font  = { italic: true, color: { argb: '888888' } };
      currentRow += 2;
      continue;
    }

    // ── Column headers ──
    COL_DEFS.forEach((col, i) => {
      const cell = ws.getCell(currentRow, i + 1);
      cell.value     = col.header;
      cell.fill      = solidFill(COLOR_HEADER_BG);
      cell.font      = headerFont(COLOR_HEADER_FG);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
      cell.border    = { bottom: { style: 'medium', color: { argb: '000000' } } };
    });
    currentRow++;

    // ── Data rows ──
    section.links.forEach((link, i) => {
      const isError = link.status === null || (link.status !== null && link.status >= 400);
      const isWarn  = link.status !== null && link.status >= 300 && link.status < 400;
      const altRow  = i % 2 === 0;
      const rowBg   = isError ? COLOR_ERROR_BG : isWarn ? 'FFF3E0' : altRow ? COLOR_ROW_ALT : 'FFFFFF';

      const vals = [link.text, link.href, link.status ?? 'ERR', link.reason ?? ''];
      vals.forEach((val, ci) => {
        const cell = ws.getCell(currentRow, ci + 1);
        cell.value     = val;
        cell.fill      = solidFill(rowBg);
        cell.alignment = { vertical: 'top', wrapText: false };
      });

      // Status column color
      const sc = ws.getCell(currentRow, 3);
      sc.alignment = { horizontal: 'center', vertical: 'top' };
      if (link.status === null) {
        sc.font = headerFont(COLOR_ERROR_FG, 11, true);
      } else if (link.status >= 400) {
        sc.font = headerFont(COLOR_ERROR_FG, 11, true);
      } else if (link.status >= 300) {
        sc.font = headerFont(COLOR_WARN_FG, 11, false);
      } else {
        sc.font = headerFont(COLOR_OK_FG, 11, false);
      }

      currentRow++;
    });

    // Blank separator
    currentRow++;
  }
}

/** Write a flat array of links into a worksheet (for cleaned sub-pages) */
function writeLinksToSheet(ws: ExcelJS.Worksheet, links: SectionLink[]): void {
  COL_DEFS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  // Column headers
  COL_DEFS.forEach((col, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value     = col.header;
    cell.fill      = solidFill(COLOR_HEADER_BG);
    cell.font      = headerFont(COLOR_HEADER_FG);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border    = { bottom: { style: 'medium', color: { argb: '000000' } } };
  });
  ws.getRow(1).height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  links.forEach((link, i) => {
    const row = i + 2;
    const isError = link.status === null || (link.status !== null && link.status >= 400);
    const isWarn  = link.status !== null && link.status >= 300 && link.status < 400;
    const altRow  = i % 2 === 0;
    const rowBg   = isError ? COLOR_ERROR_BG : isWarn ? 'FFF3E0' : altRow ? COLOR_ROW_ALT : 'FFFFFF';

    const vals = [link.text, link.href, link.status ?? 'ERR', link.reason ?? ''];
    vals.forEach((val, ci) => {
      const cell = ws.getCell(row, ci + 1);
      cell.value     = val;
      cell.fill      = solidFill(rowBg);
      cell.alignment = { vertical: 'top', wrapText: false };
    });

    const sc = ws.getCell(row, 3);
    sc.alignment = { horizontal: 'center', vertical: 'top' };
    if (link.status === null) {
      sc.font = headerFont(COLOR_ERROR_FG, 11, true);
    } else if (link.status >= 400) {
      sc.font = headerFont(COLOR_ERROR_FG, 11, true);
    } else if (link.status >= 300) {
      sc.font = headerFont(COLOR_WARN_FG, 11, false);
    } else {
      sc.font = headerFont(COLOR_OK_FG, 11, false);
    }
  });

  if (links.length > 0) {
    ws.autoFilter = { from: 'A1', to: 'D1' };
  }
}

export async function buildExcel(scan: ScanResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Link Reader API';
  wb.created = new Date();

  // ─────────────────────────────────────────────
  // Sheet 1: Summary
  // ─────────────────────────────────────────────
  const wsSummary = wb.addWorksheet('Summary');

  wsSummary.mergeCells('A1:B1');
  const titleCell = wsSummary.getCell('A1');
  titleCell.value = '📊 Scan Summary';
  titleCell.fill  = solidFill(COLOR_HEADER_BG);
  titleCell.font  = headerFont(COLOR_HEADER_FG, 13);
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  wsSummary.getRow(1).height = 28;

  const allHomeLinks = scan.sections.flatMap(s => s.links);
  const homeErrors = allHomeLinks.filter(l => l.status === null || (l.status !== null && l.status >= 400)).length;

  const durationSeconds = (scan.durationMs / 1000).toFixed(2);

  const summaryRows: [string, string | number][] = [
    ['Analyzed URL',    scan.url],
    ['Page Title',      scan.pageTitle],
    ['Scan Date',       scan.scannedAt],
    ['Duration (s)',    durationSeconds],
    ['Total Links',     scan.totalLinks],
    ['Home Links',      allHomeLinks.length],
    ['Home Errors',     homeErrors],
    ['Sub-Pages',       scan.subPages.length],
  ];

  for (const section of scan.sections) {
    summaryRows.push([`Home — ${section.section}`, section.links.length]);
  }

  summaryRows.forEach(([label, value], i) => {
    const row = i + 2;
    const lc = wsSummary.getCell(`A${row}`);
    const vc = wsSummary.getCell(`B${row}`);
    lc.value = label;
    lc.font  = { bold: true, size: 11 };
    lc.fill  = solidFill('EEF2FA');
    vc.value = value;
    vc.alignment = { wrapText: true };
    if (i % 2 === 0) vc.fill = solidFill('FAFAFA');
  });

  wsSummary.getColumn(1).width = 30;
  wsSummary.getColumn(2).width = 70;

  // ─────────────────────────────────────────────
  // Sheet 2: Home (all 3 sections grouped)
  // ─────────────────────────────────────────────
  const wsHome = wb.addWorksheet('Home');
  writeSectionsToSheet(wsHome, scan.sections);

  // ─────────────────────────────────────────────
  // Sheet 3: All Sub-Page Links (grouped by nav link heading)
  // ─────────────────────────────────────────────
  const wsSubAll = wb.addWorksheet('Sub-Pages');
  COL_DEFS.forEach((col, i) => { wsSubAll.getColumn(i + 1).width = col.width; });
  let subRow = 1;

  for (const subPage of scan.subPages) {
    // ── Heading row (nav link text) ──
    wsSubAll.mergeCells(subRow, 1, subRow, COL_DEFS.length);
    const headingCell = wsSubAll.getCell(subRow, 1);
    headingCell.value = `🔗 ${subPage.navLinkText}  —  ${subPage.navLinkHref}`;
    headingCell.fill  = solidFill(COLOR_SECTION_BG);
    headingCell.font  = headerFont(COLOR_HEADER_FG, 12);
    headingCell.alignment = { vertical: 'middle' };
    wsSubAll.getRow(subRow).height = 24;
    subRow++;

    if (subPage.links.length === 0) {
      wsSubAll.mergeCells(subRow, 1, subRow, COL_DEFS.length);
      const emptyCell = wsSubAll.getCell(subRow, 1);
      emptyCell.value = subPage.pageTitle === '(failed to load)'
        ? '❌ Failed to load page'
        : '(no links after cleanup)';
      emptyCell.font = { italic: true, color: { argb: '888888' } };
      subRow += 2;
      continue;
    }

    // ── Column headers ──
    COL_DEFS.forEach((col, i) => {
      const cell = wsSubAll.getCell(subRow, i + 1);
      cell.value     = col.header;
      cell.fill      = solidFill(COLOR_HEADER_BG);
      cell.font      = headerFont(COLOR_HEADER_FG);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
      cell.border    = { bottom: { style: 'medium', color: { argb: '000000' } } };
    });
    subRow++;

    // ── Data rows ──
    subPage.links.forEach((link, i) => {
      const isError = link.status === null || (link.status !== null && link.status >= 400);
      const isWarn  = link.status !== null && link.status >= 300 && link.status < 400;
      const altRow  = i % 2 === 0;
      const rowBg   = isError ? COLOR_ERROR_BG : isWarn ? 'FFF3E0' : altRow ? COLOR_ROW_ALT : 'FFFFFF';

      const vals = [link.text, link.href, link.status ?? 'ERR', link.reason ?? ''];
      vals.forEach((val, ci) => {
        const cell = wsSubAll.getCell(subRow, ci + 1);
        cell.value     = val;
        cell.fill      = solidFill(rowBg);
        cell.alignment = { vertical: 'top', wrapText: false };
      });

      const sc = wsSubAll.getCell(subRow, 3);
      sc.alignment = { horizontal: 'center', vertical: 'top' };
      if (link.status === null) {
        sc.font = headerFont(COLOR_ERROR_FG, 11, true);
      } else if (link.status >= 400) {
        sc.font = headerFont(COLOR_ERROR_FG, 11, true);
      } else if (link.status >= 300) {
        sc.font = headerFont(COLOR_WARN_FG, 11, false);
      } else {
        sc.font = headerFont(COLOR_OK_FG, 11, false);
      }

      subRow++;
    });

    // Blank separator between sub-pages
    subRow++;
  }

  // ─────────────────────────────────────────────
  // Sheet 4: Errors (status != 200 across all sub-pages)
  // ─────────────────────────────────────────────
  const wsErrors = wb.addWorksheet('Errors');
  const errColDefs = [
    { header: 'Source Page',  width: 30 },
    { header: 'Link Text',   width: 40 },
    { header: 'URL',         width: 70 },
    { header: 'HTTP Status', width: 14 },
    { header: 'Reason',      width: 50 },
  ];

  errColDefs.forEach((col, i) => {
    const cell = wsErrors.getCell(1, i + 1);
    cell.value     = col.header;
    cell.fill      = solidFill('8B0000');
    cell.font      = headerFont(COLOR_HEADER_FG);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { bottom: { style: 'medium', color: { argb: '000000' } } };
    wsErrors.getColumn(i + 1).width = col.width;
  });
  wsErrors.getRow(1).height = 22;
  wsErrors.views = [{ state: 'frozen', ySplit: 1 }];

  let errRow = 2;
  for (const subPage of scan.subPages) {
    const errorLinks = subPage.links.filter(
      l => l.status !== 200,
    );
    for (const link of errorLinks) {
      const altRow = (errRow - 2) % 2 === 0;
      const rowBg  = altRow ? COLOR_ERROR_BG : 'FFFFFF';

      const vals = [subPage.navLinkText, link.text, link.href, link.status ?? 'ERR', link.reason ?? ''];
      vals.forEach((val, ci) => {
        const cell = wsErrors.getCell(errRow, ci + 1);
        cell.value     = val;
        cell.fill      = solidFill(rowBg);
        cell.alignment = { vertical: 'top', wrapText: false };
      });

      const sc = wsErrors.getCell(errRow, 4);
      sc.alignment = { horizontal: 'center', vertical: 'top' };
      sc.font = headerFont(COLOR_ERROR_FG, 11, true);

      errRow++;
    }
  }

  if (errRow > 2) {
    wsErrors.autoFilter = { from: 'A1', to: 'E1' };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
