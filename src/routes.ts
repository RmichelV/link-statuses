import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { scanPage, ScanResult } from './scanner';

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
    .then((result) => {
      scans.set(id, { status: 'done', result });
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

export default router;
