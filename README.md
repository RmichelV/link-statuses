# Link Status Scanner

API REST que analiza todos los links de un sitio web, reporta su estado HTTP real (200, 404, null, etc.) y al finalizar genera automáticamente un archivo Excel con los resultados.

---

## Requisitos previos

Antes de comenzar asegúrate de tener instalado:

- [Node.js](https://nodejs.org/) v18 o superior
- npm (incluido con Node.js)
- Git

Verifica con:

```bash
node -v
npm -v
git --version
```

---

## 1. Clonar el repositorio

```bash
git clone https://github.com/RmichelV/link-statuses.git
cd link-statuses
```

---

## 2. Instalar dependencias

```bash
npm install
```

Esto instala todo lo necesario: Express, Axios, Cheerio, ExcelJS, tsx, TypeScript, etc.

---

## 3. Iniciar el servidor

### Modo desarrollo (recomendado — reinicia automáticamente al guardar cambios)

```bash
npm run dev
```

### Modo producción

```bash
npm start
```

Al iniciar verás en la terminal:

```
Link Reader API corriendo en http://localhost:3000
```

El servidor queda escuchando en **http://localhost:3000**. No cierres esta terminal — aquí verás el progreso del escaneo en tiempo real.

---

## 4. Realizar un escaneo

### Opción A — Thunder Client (extensión de VS Code)

1. Abre VS Code → instala la extensión **Thunder Client**.
2. Crea una nueva request:
   - **Method:** `POST`
   - **URL:** `http://localhost:3000/api/scan`
   - **Body → JSON:**

```json
{
  "url": "https://www.ejemplo.com",
  "concurrency": 5,
  "delayMin": 300,
  "delayMax": 1500,
  "maxDepth": 2
}
```

3. Haz clic en **Send**.
4. Recibirás una respuesta con el `id` del escaneo:

```json
{
  "id": "abc123-...",
  "message": "Escaneo iniciado. Consulta el estado con GET /scan/:id"
}
```

---

### Opción B — Postman

1. Abre Postman → nueva request.
2. Configura igual que en Thunder Client (POST, URL y body JSON arriba).
3. Haz clic en **Send**.

---

## 5. Consultar el estado del escaneo

Crea una segunda request:

- **Method:** `GET`
- **URL:** `http://localhost:3000/api/scan/<id>`

Reemplaza `<id>` con el valor recibido en el paso anterior.

Respuesta mientras está en curso:

```json
{
  "id": "abc123-...",
  "status": "running"
}
```

Respuesta al terminar:

```json
{
  "id": "abc123-...",
  "status": "done",
  "data": { ... }
}
```

---

## 6. Resultados en la terminal

Mientras el escaneo está en curso, la terminal del servidor muestra el progreso link por link:

```
🔍 [SCAN] Iniciando: https://www.ejemplo.com
   Concurrencia: 5 | Delay: 300-1500ms | Profundidad: 2
   Cargando página raíz...
   ✅ Página raíz cargada: "Ejemplo - Inicio"
   🔗 Links encontrados en raíz: 87

📡 [Depth 1] Fetching 87 URLs únicas...
   ✅ [1/87] 200 → https://www.ejemplo.com/nosotros
   ⚠️ [2/87] 404 → https://www.ejemplo.com/pagina-rota
   ❌ [3/87] NULL → https://sitio-que-no-existe.com

✅ [SCAN COMPLETADO] 94.2s
   Total links: 312 | Errores/4xx: 8 | Páginas visitadas: 14

📥 Excel guardado: C:\...\link-statuses\scan-www-ejemplo-com-2026-04-03.xlsx
```

**Iconos:**
| Ícono | Significado |
|-------|-------------|
| ✅ | Link OK (2xx) |
| ⚠️ | Error del cliente/servidor (4xx / 5xx) |
| ❌ | Sin respuesta — URL inválida, DNS no encontrado, timeout |

---

## 7. Archivo Excel generado automáticamente

Al terminar el escaneo, se genera y **abre automáticamente** un archivo `.xlsx` en la raíz del proyecto con el nombre:

```
scan-<dominio>-<fecha>.xlsx
```

El archivo contiene 3 hojas:

| Hoja | Contenido |
|------|-----------|
| **Resumen** | URL analizada, título, fecha, duración, totales |
| **Todos los links** | Href original, URL resuelta, status HTTP, texto, página donde fue encontrado, profundidad |
| **Errores** | Solo los links con status 4xx, 5xx o sin respuesta (null) |

---

## 8. Descargar el Excel manualmente (opcional)

También puedes descargarlo desde Thunder Client o Postman:

- **Method:** `GET`
- **URL:** `http://localhost:3000/api/scan/<id>/export`

En Thunder Client: clic en **Save Response** para guardar el archivo.

---

## Parámetros del body

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `url` | string | **requerido** | URL del sitio a analizar (debe iniciar con `http://` o `https://`) |
| `concurrency` | number | `5` | Cantidad de requests simultáneos |
| `delayMin` | number | `300` | Delay mínimo entre requests (ms) |
| `delayMax` | number | `1500` | Delay máximo entre requests (ms) |
| `maxDepth` | number | `2` | Profundidad de rastreo (1 = solo links del index, 2 = links de links, etc.) |

> **Nota:** A mayor `maxDepth` y menor `delayMin`, el escaneo será más rápido pero más agresivo. En sitios reales se recomienda `concurrency: 5`, `delayMin: 300`.

---

## Scripts disponibles

```bash
npm run dev     # Modo desarrollo con recarga automática
npm start       # Modo producción
npm run build   # Compila TypeScript a JavaScript (carpeta dist/)
```

---

## Estructura del proyecto

```
link-statuses/
├── src/
│   ├── bootstrap.ts   # Punto de entrada
│   ├── server.ts      # Configuración de Express
│   ├── routes.ts      # Endpoints de la API
│   ├── scanner.ts     # Lógica de rastreo de links
│   ├── excel.ts       # Generación del archivo Excel
│   └── stealth.ts     # Headers y delays anti-bloqueo
├── package.json
├── tsconfig.json
└── README.md
```
