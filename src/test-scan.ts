import { scanPage } from './scanner';

(async () => {
  try {
    const result = await scanPage('https://example.com', 3, 100, 500);
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
  process.exit(0);
})();
