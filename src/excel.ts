import ExcelJS from 'exceljs';
import { ScanResult } from './scanner';

const COLOR_HEADER_BG = '2B579A';
const COLOR_HEADER_FG = 'FFFFFF';
const COLOR_ERROR_BG  = 'FDECEA';
const COLOR_ERROR_FG  = 'C0392B';
const COLOR_WARN_FG   = 'CC6600';
const COLOR_OK_FG     = '1E7E34';
const COLOR_ROW_ALT   = 'F0F7FF';

const solidFill = (color: string): ExcelJS.Fill => ({
  type: 'pattern', pattern: 'solid', fgColor: { argb: color },
});

const headerFont = (color: string, size = 11, bold = true): Partial<ExcelJS.Font> => ({
  bold, color: { argb: color }, size,
});

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

  const allLinks = scan.sections.flatMap(s => s.links);
  const errorCount = allLinks.filter(l => l.status === null || (l.status !== null && l.status >= 400)).length;

  const summaryRows: [string, string | number][] = [
    ['Analyzed URL',  scan.url],
    ['Page Title',    scan.pageTitle],
    ['Scan Date',     scan.scannedAt],
    ['Duration (ms)', scan.durationMs],
    ['Total Links',   scan.totalLinks],
    ['Errors',        errorCount],
    ['OK Links',      scan.totalLinks - errorCount],
  ];

  for (const section of scan.sections) {
    summaryRows.push([`${section.section} Links`, section.links.length]);
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
  // One sheet per section (Navigation, Footer, DDC Wrapper)
  // ─────────────────────────────────────────────
  const colDefs = [
    { header: 'Link Text',   width: 40 },
    { header: 'URL',         width: 70 },
    { header: 'HTTP Status', width: 14 },
    { header: 'Reason',      width: 50 },
  ];

  for (const section of scan.sections) {
    const sheetName = section.section.substring(0, 31);
    const ws = wb.addWorksheet(sheetName);

    // Column headers
    colDefs.forEach((col, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value     = col.header;
      cell.fill      = solidFill(COLOR_HEADER_BG);
      cell.font      = headerFont(COLOR_HEADER_FG);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
      cell.border    = { bottom: { style: 'medium', color: { argb: '000000' } } };
      ws.getColumn(i + 1).width = col.width;
    });
    ws.getRow(1).height = 22;
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Data rows
    section.links.forEach((link, i) => {
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

      // Status column color
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

    if (section.links.length > 0) {
      ws.autoFilter = { from: 'A1', to: 'D1' };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
