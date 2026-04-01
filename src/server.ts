/**
 * HTTP server for the ratchet platform API.
 * Provides endpoints for receiving scan results, webhooks, and badge data.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createRegistryRouter } from './registry/routes.js';

export const app = express();

// ── Security middleware
const corsOptions: cors.CorsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? false,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ── Rate limiting: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── Authentication middleware
function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || token !== process.env.RATCHET_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ── Score Registry routes
app.use('/api/v1', createRegistryRouter());

// ── Public routes
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── Protected routes
app.post('/api/results', authenticate, (req: Request, res: Response) => {
  const { owner, repo, scan } = req.body as { owner?: string; repo?: string; scan?: unknown };
  if (!owner || !repo || !scan) {
    res.status(400).json({ error: 'Missing required fields: owner, repo, scan' });
    return;
  }
  res.json({ ok: true, received: true });
});

app.get('/api/badge/:owner/:repo', authenticate, (req: Request, res: Response) => {
  const { owner, repo } = req.params;
  res.json({ owner, repo, status: 'ok' });
});

export function startServer(port = 3000): void {
  app.listen(port, () => {
    process.stdout.write(`ratchet server listening on port ${port}\n`);
  });
}
