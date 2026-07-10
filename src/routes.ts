import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { scanPage, ScanResult } from './scanner';
import { buildExcel } from './excel';

const router = Router();

const scans = new Map<string, { status: 'running' | 'done' | 'error'; result?: ScanResult; error?: string }>();

router.post('/scan', (req: Request, res: Response): void => {
  const { url, concurrency, delayMin, delayMax } = req.body;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Se requiere el campo "url" (string).' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      res.status(400).json({ error: 'La URL debe usar protocolo http o https.' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'URL inválida.' });
    return;
  }

  const id = uuidv4();
  scans.set(id, { status: 'running' });

  scanPage(
    parsed.href,
    concurrency ?? 5,
    delayMin ?? 300,
    delayMax ?? 1500,
  )
    .then(async (result) => {
      scans.set(id, { status: 'done', result });

      // Guardar Excel automáticamente en la raíz del proyecto y abrirlo
      try {
        const buffer = await buildExcel(result);
        const hostname = new URL(result.url).hostname.replace(/[^a-z0-9]/gi, '-');
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
        const filename = `scan-${hostname}-${date}-${time}.xlsx`;
        const downloadsDir = path.resolve(process.env.USERPROFILE ?? process.cwd(), 'Downloads');
        if (!fs.existsSync(downloadsDir)) {
          fs.mkdirSync(downloadsDir, { recursive: true });
        }
        const outputPath = path.join(downloadsDir, filename);
        fs.writeFileSync(outputPath, buffer);
        console.log(`\n📥 Excel guardado: ${outputPath}`);
        // Abrir automáticamente con la app predeterminada (Excel en Windows)
        exec(`start "" "${outputPath}"`);
      } catch (err: any) {
        console.error(`\n❌ Error al guardar Excel: ${err.message}`);
      }
    })
    .catch((err) => {
      scans.set(id, { status: 'error', error: err.message ?? 'Error desconocido' });
    });

  res.status(202).json({ id, message: 'Escaneo iniciado. Consulta el estado con GET /scan/:id' });
});

router.get('/scan/:id', (req: Request, res: Response): void => {
  const id = req.params.id as string;
  const entry = scans.get(id);
  if (!entry) {
    res.status(404).json({ error: 'Scan no encontrado.' });
    return;
  }

  if (entry.status === 'running') {
    res.json({ id, status: 'running' });
    return;
  }

  if (entry.status === 'error') {
    res.json({ id, status: 'error', error: entry.error });
    return;
  }

  res.json({ id, status: 'done', data: entry.result });
});

// PATCH /scan/:id/link  — update the reason of a specific link in memory
router.patch('/scan/:id/link', (req: Request, res: Response): void => {
  const id    = req.params.id as string;
  const entry = scans.get(id);

  if (!entry || entry.status !== 'done' || !entry.result) {
    res.status(404).json({ error: 'Scan not found or not completed.' });
    return;
  }

  const { source, href, reason, status: newStatus } = req.body as {
    source?: string; href?: string; reason?: string; status?: number | null;
  };
  if (typeof href !== 'string' || typeof source !== 'string') {
    res.status(400).json({ error: 'Required fields: source (string), href (string).' });
    return;
  }

  let updated = 0;
  const result = entry.result;

  const applyToLink = (link: { href: string; reason: string | null; status: number | null }) => {
    if (link.href !== href) return;
    if (typeof reason === 'string') link.reason = reason;
    if (newStatus !== undefined)   link.status = newStatus;
    updated++;
  };

  // Update in home sections
  for (const section of result.sections) {
    if (source === 'Home') section.links.forEach(applyToLink);
  }

  // Update in sub-pages
  for (const subPage of result.subPages) {
    if (source === subPage.navLinkText) subPage.links.forEach(applyToLink);
  }

  if (updated === 0) {
    res.status(404).json({ error: 'Link not found.' });
    return;
  }

  res.json({ ok: true, updated });
});

router.get('/scan/:id/export', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const entry = scans.get(id);

  if (!entry) {
    res.status(404).json({ error: 'Scan no encontrado.' });
    return;
  }
  if (entry.status === 'running') {
    res.status(400).json({ error: 'El escaneo aún está en progreso.' });
    return;
  }
  if (entry.status === 'error' || !entry.result) {
    res.status(400).json({ error: 'El escaneo falló o no tiene resultados.' });
    return;
  }

  try {
    const buffer = await buildExcel(entry.result);
    const hostname = new URL(entry.result.url).hostname.replace(/[^a-z0-9]/gi, '-');
    const now  = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const filename = `scan-${hostname}-${date}-${time}.xlsx`;

    // Save updated copy to Downloads and open it
    const downloadsDir = path.resolve(process.env.USERPROFILE ?? process.cwd(), 'Downloads');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
    const outputPath = path.join(downloadsDir, filename);
    fs.writeFileSync(outputPath, buffer);
    console.log(`\n📥 Excel actualizado guardado: ${outputPath}`);
    exec(`start "" "${outputPath}"`);

    // Also stream to browser
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: 'Error generando el Excel.', detail: err.message });
  }
});

export default router;
