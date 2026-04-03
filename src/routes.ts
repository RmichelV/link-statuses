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
  const { url, concurrency, delayMin, delayMax, maxDepth } = req.body;

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
    maxDepth ?? 2
  )
    .then(async (result) => {
      scans.set(id, { status: 'done', result });

      // Guardar Excel automáticamente en la raíz del proyecto y abrirlo
      try {
        const buffer = await buildExcel(result);
        const hostname = new URL(result.url).hostname.replace(/[^a-z0-9]/gi, '-');
        const date = new Date().toISOString().slice(0, 10);
        const filename = `scan-${hostname}-${date}.xlsx`;
        const outputPath = path.resolve(process.cwd(), filename);
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
    const filename = `scan-${id}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
    console.log(`📥 Excel exportado: ${filename} (${buffer.length} bytes)`);
  } catch (err: any) {
    res.status(500).json({ error: 'Error generando el Excel.', detail: err.message });
  }
});

export default router;
