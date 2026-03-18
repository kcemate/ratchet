import { createServer } from './server.js';

const port = parseInt(process.env.RATCHET_API_PORT ?? '3100', 10);

export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const app = createServer();
    const server = app.listen(port, () => {
      console.log(`Ratchet API listening on http://localhost:${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}
