# Link Status Scanner

REST API that audits website links, reports real HTTP status codes (200, 404, null, etc.), and automatically generates an Excel report when the scan finishes.

---

## Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/) v18+
- npm (bundled with Node.js)
- Git

Check versions:

```bash
node -v
npm -v
git --version
```

---

## 1. Clone The Repository

```bash
git clone https://github.com/RmichelV/link-statuses.git
cd link-statuses
```

---

## 2. Install Dependencies

```bash
npm install
```

This installs all required packages (Express, Axios, Cheerio, ExcelJS, tsx, TypeScript, etc.).

---

## 3. Run Locally (Development Only)

Use development mode only:

```bash
npm run dev
```

The API will run at:

```text
http://localhost:3000
```

Keep this terminal open to see real-time scan progress.

---

## 4. Start A Scan (POST /api/scan)

Use Thunder Client, Postman, or curl.

### Required Request Headers

- `Content-Type: application/json`
- `Accept: application/json`

### Request URL

```text
http://localhost:3000/api/scan
```

### Request Body (use this payload)

```json
{
  "url": "URL",
  "concurrency": 5,
  "delayMin": 300,
  "delayMax": 1500,
  "maxDepth": 2
}
```

Example response:

```json
{
  "id": "abc123-...",
  "message": "Escaneo iniciado. Consulta el estado con GET /scan/:id"
}
```

> Note: `maxDepth` is included in this payload format for compatibility with previous requests.

---

## 5. Excel Output

When the scan finishes, an `.xlsx` file is automatically generated (and opened) in the project root:

```text
scan-<domain>-<date>.xlsx
```

Current workbook includes:

- `Summary`
- `Home`
- `Sub-Pages` (all nav-analyzed pages grouped by heading)
- `Errors` (all links with status different from 200)

You can also download it manually:

- Method: `GET`
- URL: `http://localhost:3000/api/scan/<id>/export`

---

## Available Scripts

```bash
npm run dev     # Local development (watch mode)
npm run build   # Compile TypeScript to dist/
```

---

## Project Structure

```text
link-statuses/
├── src/
│   ├── bootstrap.ts
│   ├── server.ts
│   ├── routes.ts
│   ├── scanner.ts
│   ├── excel.ts
│   └── stealth.ts
├── package.json
├── tsconfig.json
└── README.md
```
