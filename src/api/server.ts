import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';

import authRouter from './routes/auth.js';
import usageRouter from './routes/usage.js';
import billingRouter from './routes/billing.js';

export function createServer() {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS — allow ratchet CLI and web dashboard
  app.use(cors({
    origin: process.env.RATCHET_CORS_ORIGIN?.split(',') ?? [
      'https://ratchetcli.com',
      'http://localhost:3000',
      'http://localhost:5173',
    ],
    credentials: true,
  }));

  // Rate limiting — 100 req/min per IP globally
  app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  }));

  // Raw body for Stripe webhook signature verification
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

  // JSON body parsing for all other routes
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version ?? '1.0.0' });
  });

  // Route modules
  app.use('/api/auth', authRouter);
  app.use('/api/usage', usageRouter);
  app.use('/api/billing', billingRouter);

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
