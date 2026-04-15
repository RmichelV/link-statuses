# Test Site Simple

Sitio de prueba con 10 páginas HTML interconectadas para testear el scanner.

## Estructura

- **10 páginas**: `page-1.html` a `page-10.html`
- **Cada página** linke a **al menos 5 de las otras 9 páginas**
- **Patrón**: página i linke a páginas (i+1), (i+2), (i+3), (i+4), (i+5) — con wrap-around

## Usar

### 1. Generar páginas

```bash
node generate.js
```

Crea 10 archivos HTML en `./public/`

### 2. Iniciar servidor

```bash
node server.js
```

Servidor en `http://localhost:5000`

### 3. Escanear

En Thunder Client o Postman:

```
POST http://localhost:3000/api/scan
{
  "url": "http://localhost:5000/page-1.html",
  "concurrency": 5,
  "delayMin": 100,
  "delayMax": 500,
  "maxDepth": 2
}
```

## Características

- ✅ Todas las páginas retornan 200 OK
- ✅ Links internos válidos
- ✅ Fácil de debuggear
- ✅ Sin dependencias externas (solo Node.js)
- ✅ Rápido, ideal para pruebas locales
