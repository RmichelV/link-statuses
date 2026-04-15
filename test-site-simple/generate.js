const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, 'public');

// Crear 10 páginas
for (let i = 1; i <= 10; i++) {
  const links = [];
  
  // Cada página linke a las próximas 5 páginas (con wrap-around)
  for (let j = 1; j <= 5; j++) {
    const targetPage = ((i - 1 + j) % 10) + 1;
    links.push(`page-${targetPage}.html`);
  }

  const navItems = Array.from({length: 10}, (_, idx) => {
    const pageNum = idx + 1;
    if (pageNum === i) {
      return `<strong style="color: #2B579A; font-weight: bold;">${pageNum}</strong>`;
    }
    return `<a href="page-${pageNum}.html" style="color: #0066cc; text-decoration: none; margin: 0 8px;">${pageNum}</a>`;
  }).join(' | ');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Página ${i}</title>
  <link rel="stylesheet" href="style.css">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
    nav { background-color: #f0f0f0; padding: 15px 20px; border-bottom: 2px solid #2B579A; }
    nav p { margin: 0; font-size: 14px; }
    main { margin: 20px; }
    h1 { color: #2B579A; }
    .links { margin-top: 20px; }
    a { display: block; margin: 10px 0; color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { margin-top: 30px; border: none; border-top: 1px solid #ddd; }
    section { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #2B579A; }
  </style>
</head>
<body>
  <nav>
    <p><strong>Navegación:</strong> ${navItems}</p>
  </nav>
  
  <main>
    <h1>Página ${i}</h1>
    <p>Esta es la página ${i} de 10. Este sitio de prueba contiene páginas interconectadas para testear el scanner.</p>
    
    <div class="links">
      <h2>Links principales a otras páginas:</h2>
${links.map(link => `      <a href="${link}">${link}</a>`).join('\n')}
    </div>

    <section>
      <h2>Anclas internas (anchors):</h2>
      <a href="#section-content">Ir a Contenido</a>
      <a href="#section-resources">Ir a Recursos</a>
      <a href="#section-footer">Ir a Footer</a>
    </section>

    <section id="section-content">
      <h3>Contenido Principal</h3>
      <p>Esta es una sección con un ID que permite anclas internas.</p>
      <a href="external-resource.html">Recurso Externo</a>
    </section>

    <section id="section-resources">
      <h3>Recursos</h3>
      <p>Enlaces a recursos:</p>
      <a href="/api/data.json">JSON Data API</a>
      <a href="/assets/download.zip">Descargar ZIP</a>
    </section>

    <section id="section-footer">
      <h3>Footer</h3>
      <a href="https://github.com/example/test-site">GitHub Repository</a>
      <a href="https://example.com/privacy">Privacy Policy</a>
    </section>
    
    <hr>
    <p><small>© 2026 Test Site Simple</small></p>
  </main>

  <script src="app.js"></script>
</body>
</html>`;

  fs.writeFileSync(path.join(publicDir, `page-${i}.html`), html, 'utf-8');
  console.log(`✅ Creada: page-${i}.html`);
}

console.log('\n🎉 10 páginas HTML generadas en ./public/');
