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
  // Hoja 1: Resumen
  // ─────────────────────────────────────────────
  const wsSummary = wb.addWorksheet('Resumen');

  const headerFill = (color: string): ExcelJS.Fill => ({
    type: 'pattern', pattern: 'solid', fgColor: { argb: color },
  });
  const headerFont = (color: string, size = 11, bold = true): Partial<ExcelJS.Font> => ({
    bold, color: { argb: color }, size,
  });

  // Título
  wsSummary.mergeCells('A1:B1');
  const titleCell = wsSummary.getCell('A1');
  titleCell.value = '📊 Resumen del escaneo';
  titleCell.fill  = headerFill(COLOR_HEADER_BG);
  titleCell.font  = headerFont(COLOR_HEADER_FG, 13);
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  wsSummary.getRow(1).height = 28;

  const summaryRows: [string, string | number][] = [
    ['URL analizada',          scan.url],
    ['Título de página',       scan.pageTitle],
    ['Fecha de escaneo',       scan.scannedAt],
    ['Duración (ms)',          scan.durationMs],
    ['Profundidad máx.',       scan.maxDepth],
    ['Páginas visitadas',      scan.pagesVisited],
    ['Total links analizados', scan.totalLinks],
    ['Links con error/4xx',    scan.links.filter(l => l.status === null || (l.status !== null && l.status >= 400)).length],
    ['Links OK (2xx/3xx)',     scan.links.filter(l => l.status !== null && l.status < 400).length],
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
  // Hoja 2: Todos los links
  // ─────────────────────────────────────────────
  const wsAll = wb.addWorksheet('Todos los links');

  const colDefs = [
    { header: 'Texto del link', key: 'text',        width: 35 },
    { header: 'Href (original)', key: 'href',       width: 65 },
    { header: 'URL resuelta',   key: 'resolvedUrl', width: 65 },
    { header: 'Status HTTP',    key: 'status',      width: 14 },
    { header: 'Motivo',         key: 'reason',      width: 50 },
    { header: 'Error',          key: 'error',       width: 30 },
    { header: 'Encontrado en',  key: 'foundOn',     width: 65 },
    { header: 'Profundidad',    key: 'depth',       width: 14 },
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

  // Auto-filtro en encabezados
  wsAll.autoFilter = { from: 'A1', to: `H1` };
  const wsErrors = wb.addWorksheet('Errores');

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

  wsErrors.autoFilter = { from: 'A1', to: `H1` };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
