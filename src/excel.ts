import ExcelJS from 'exceljs';
import { ScanResult } from './scanner';

const COLOR_HEADER_BG  = '2B579A';
const COLOR_HEADER_FG  = 'FFFFFF';
const COLOR_ERROR_BG   = 'FDECEA';
const COLOR_ERROR_FG   = 'C0392B';
const COLOR_WARN_BG    = 'FFF3E0';
const COLOR_WARN_FG    = 'CC6600';
const COLOR_OK_FG      = '1E7E34';
const COLOR_ROW_ALT    = 'F0F7FF';

export async function buildExcel(scan: ScanResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Link Reader API';
  wb.created = new Date();

  // ─────────────────────────────────────────────
  // Sheet 1: Summary
  // ─────────────────────────────────────────────
  const wsSummary = wb.addWorksheet('Summary');

  const headerFill = (color: string): ExcelJS.Fill => ({
    type: 'pattern', pattern: 'solid', fgColor: { argb: color },
  });
  const headerFont = (color: string, size = 11, bold = true): Partial<ExcelJS.Font> => ({
    bold, color: { argb: color }, size,
  });

  // Title
  wsSummary.mergeCells('A1:B1');
  const titleCell = wsSummary.getCell('A1');
  titleCell.value = '📊 Scan Summary';
  titleCell.fill  = headerFill(COLOR_HEADER_BG);
  titleCell.font  = headerFont(COLOR_HEADER_FG, 13);
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  wsSummary.getRow(1).height = 28;

  const summaryRows: [string, string | number][] = [
    ['Analyzed URL',          scan.url],
    ['Page Title',            scan.pageTitle],
    ['Scan Date',             scan.scannedAt],
    ['Duration (ms)',         scan.durationMs],
    ['Max Depth',             scan.maxDepth],
    ['Pages Visited',         scan.pagesVisited],
    ['Total Links Analyzed',  scan.totalLinks],
    ['Links with Errors/4xx', scan.links.filter(l => l.status === null || (l.status !== null && l.status >= 400)).length],
    ['OK Links (2xx/3xx)',    scan.links.filter(l => l.status !== null && l.status < 400).length],
  ];

  summaryRows.forEach(([label, value], i) => {
    const row = i + 2;
    const labelCell = wsSummary.getCell(`A${row}`);
    const valueCell = wsSummary.getCell(`B${row}`);
    labelCell.value = label;
    labelCell.font  = { bold: true, size: 11 };
    labelCell.fill  = headerFill('EEF2FA');
    valueCell.value = value;
    valueCell.alignment = { wrapText: true };
    if (i % 2 === 0) {
      valueCell.fill = headerFill('FAFAFA');
    }
  });

  wsSummary.getColumn(1).width = 30;
  wsSummary.getColumn(2).width = 70;

  // ─────────────────────────────────────────────
  // Sheet 2: All Links
  // ─────────────────────────────────────────────
  const wsAll = wb.addWorksheet('All Links');

  const colDefs = [
    { header: 'Link Text',      key: 'text',        width: 35 },
    { header: 'Original Href',  key: 'href',       width: 65 },
    { header: 'Resolved URL',   key: 'resolvedUrl', width: 65 },
    { header: 'HTTP Status',    key: 'status',      width: 14 },
    { header: 'Reason',         key: 'reason',      width: 50 },
    { header: 'Error',          key: 'error',       width: 30 },
    { header: 'Found On',       key: 'foundOn',     width: 65 },
    { header: 'Depth',          key: 'depth',       width: 14 },
  ];

  // Encabezados
  colDefs.forEach((col, i) => {
    const cell = wsAll.getCell(1, i + 1);
    cell.value     = col.header;
    cell.fill      = headerFill(COLOR_HEADER_BG);
    cell.font      = headerFont(COLOR_HEADER_FG);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border    = { bottom: { style: 'medium', color: { argb: '000000' } } };
    wsAll.getColumn(i + 1).width = col.width;
  });
  wsAll.getRow(1).height = 22;
  wsAll.views = [{ state: 'frozen', ySplit: 1 }];

  // Filas de datos
  scan.links.forEach((link, i) => {
    const row = i + 2;
    const isError = link.status === null || (link.status !== null && link.status >= 400);
    const isWarn  = link.status !== null && link.status >= 300 && link.status < 400;
    const altRow  = i % 2 === 0;
    const rowBg   = isError ? COLOR_ERROR_BG : isWarn ? COLOR_WARN_BG : altRow ? COLOR_ROW_ALT : 'FFFFFF';

    const values = [
      link.text,
      link.href,
      link.resolvedUrl ?? '',
      link.status ?? 'NULL',
      link.reason ?? '',
      link.error ?? '',
      link.foundOn,
      link.depth,
    ];

    values.forEach((val, ci) => {
      const cell = wsAll.getCell(row, ci + 1);
      cell.value = val;
      cell.fill  = headerFill(rowBg);
      cell.alignment = { vertical: 'top', wrapText: false };
    });

    // Columna Status: color especial
    const statusCell = wsAll.getCell(row, 4);
    statusCell.alignment = { horizontal: 'center', vertical: 'top' };
    if (link.status === null) {
      statusCell.font = headerFont(COLOR_ERROR_FG, 11, true);
    } else if (link.status >= 400) {
      statusCell.font = headerFont(COLOR_ERROR_FG, 11, true);
    } else if (link.status >= 300) {
      statusCell.font = headerFont(COLOR_WARN_FG, 11, false);
    } else {
      statusCell.font = headerFont(COLOR_OK_FG, 11, false);
    }
  });

  // Auto-filter on headers
  wsAll.autoFilter = { from: 'A1', to: `H1` };
  const wsErrors = wb.addWorksheet('Errors');

  colDefs.forEach((col, i) => {
    const cell = wsErrors.getCell(1, i + 1);
    cell.value     = col.header;
    cell.fill      = headerFill('8B0000');
    cell.font      = headerFont(COLOR_HEADER_FG);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = { bottom: { style: 'medium', color: { argb: '000000' } } };
    wsErrors.getColumn(i + 1).width = col.width;
  });
  wsErrors.getRow(1).height = 22;
  wsErrors.views = [{ state: 'frozen', ySplit: 1 }];

  const errorLinks = scan.links.filter(
    l => l.status === null || (l.status !== null && l.status >= 400)
  );

  errorLinks.forEach((link, i) => {
    const row = i + 2;
    const altRow = i % 2 === 0;
    const rowBg  = altRow ? COLOR_ERROR_BG : 'FFFFFF';

    const values = [
      link.text,
      link.href,
      link.resolvedUrl ?? '',
      link.status ?? 'NULL',
      link.reason ?? '',
      link.error ?? '',
      link.foundOn,
      link.depth,
    ];

    values.forEach((val, ci) => {
      const cell = wsErrors.getCell(row, ci + 1);
      cell.value = val;
      cell.fill  = headerFill(rowBg);
      cell.alignment = { vertical: 'top', wrapText: false };
    });

    const statusCell = wsErrors.getCell(row, 4);
    statusCell.font      = headerFont(COLOR_ERROR_FG, 11, true);
    statusCell.alignment = { horizontal: 'center', vertical: 'top' };
  });

  wsErrors.autoFilter = { from: 'A1', to: `H1` }; // Auto-filter on headers

  // ─────────────────────────────────────────────
  // Sheet 4: Links by Page
  // ─────────────────────────────────────────────
  const wsByPage = wb.addWorksheet('Links by Page');

  // Group links by foundOn
  const pageMap = new Map<string, typeof scan.links>();
  for (const link of scan.links) {
    const arr = pageMap.get(link.foundOn) ?? [];
    arr.push(link);
    pageMap.set(link.foundOn, arr);
  }

  const pageColDefs = [
    { header: 'Link Text',     width: 35 },
    { header: 'Original Href', width: 65 },
    { header: 'HTTP Status',   width: 14 },
    { header: 'Reason',        width: 50 },
  ];

  // Set column widths
  pageColDefs.forEach((col, i) => {
    wsByPage.getColumn(i + 1).width = col.width;
  });

  let currentRow = 1;

  for (const [pageUrl, links] of pageMap) {
    const errorCount = links.filter(l => l.status === null || (l.status !== null && l.status >= 400)).length;
    const okCount = links.length - errorCount;

    // Page header row (merged across all columns)
    wsByPage.mergeCells(currentRow, 1, currentRow, pageColDefs.length);
    const pageHeaderCell = wsByPage.getCell(currentRow, 1);
    pageHeaderCell.value = `📄 ${pageUrl}`;
    pageHeaderCell.fill  = headerFill(COLOR_HEADER_BG);
    pageHeaderCell.font  = headerFont(COLOR_HEADER_FG, 12);
    pageHeaderCell.alignment = { vertical: 'middle' };
    wsByPage.getRow(currentRow).height = 24;
    currentRow++;

    // Stats row
    wsByPage.mergeCells(currentRow, 1, currentRow, pageColDefs.length);
    const statsCell = wsByPage.getCell(currentRow, 1);
    statsCell.value = `Total: ${links.length}  |  OK: ${okCount}  |  Errors: ${errorCount}`;
    statsCell.fill  = headerFill('EEF2FA');
    statsCell.font  = { size: 10, italic: true };
    currentRow++;

    // Column headers
    pageColDefs.forEach((col, i) => {
      const cell = wsByPage.getCell(currentRow, i + 1);
      cell.value     = col.header;
      cell.fill      = headerFill('4A4A4A');
      cell.font      = headerFont(COLOR_HEADER_FG, 10);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border    = { bottom: { style: 'thin', color: { argb: '999999' } } };
    });
    currentRow++;

    // Link rows
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const isError = link.status === null || (link.status !== null && link.status >= 400);
      const altRow  = i % 2 === 0;
      const rowBg   = isError ? COLOR_ERROR_BG : altRow ? COLOR_ROW_ALT : 'FFFFFF';

      const vals = [
        link.text,
        link.href,
        link.status ?? 'NULL',
        link.reason ?? '',
      ];

      vals.forEach((val, ci) => {
        const cell = wsByPage.getCell(currentRow, ci + 1);
        cell.value = val;
        cell.fill  = headerFill(rowBg);
        cell.alignment = { vertical: 'top', wrapText: false };
      });

      // Status color
      const statusCell = wsByPage.getCell(currentRow, 3);
      statusCell.alignment = { horizontal: 'center', vertical: 'top' };
      if (link.status === null) {
        statusCell.font = headerFont(COLOR_ERROR_FG, 10, true);
      } else if (link.status >= 400) {
        statusCell.font = headerFont(COLOR_ERROR_FG, 10, true);
      } else if (link.status >= 300) {
        statusCell.font = headerFont(COLOR_WARN_FG, 10, false);
      } else {
        statusCell.font = headerFont(COLOR_OK_FG, 10, false);
      }

      currentRow++;
    }

    // Blank separator row
    currentRow++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
