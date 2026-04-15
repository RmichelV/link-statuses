const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const publicDir = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  // Ruta por defecto: index
  let filePath = req.url === '/' ? '/page-1.html' : req.url;
  filePath = path.join(publicDir, filePath);

  // Sanitizar para evitar directory traversal
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Acceso prohibido');
    return;
  }

  // Leer el archivo
  fs.readFile(filePath, 'utf-8', (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <head><title>404 Not Found</title></head>
            <body>
              <h1>404 - Página no encontrada</h1>
              <p>El archivo <code>${req.url}</code> no existe.</p>
              <p><a href="/">Volver al inicio</a></p>
            </body>
          </html>
        `);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error del servidor');
      }
      return;
    }

    // Servir el archivo
    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ Servidor de prueba ejecutando en http://localhost:${PORT}`);
  console.log(`   Abre http://localhost:${PORT}/page-1.html para comenzar\n`);
});
