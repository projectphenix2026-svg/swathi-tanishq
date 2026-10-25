import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import authRoutes, { requireAuth } from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import templateRoutes from './routes/templates.js';
import campaignRoutes from './routes/campaigns.js';
import inboxRoutes from './routes/inbox.js';
import dashboardRoutes from './routes/dashboard.js';
import webhookRoutes from './routes/webhooks.js';
import occasionRoutes from './routes/occasions.js';
import leadRoutes from './routes/leads.js';
import offerRoutes from './routes/offers.js';
import whatsappRoutes from './routes/whatsapp.js';
import exportRoutes from './routes/export.js';
import { upload as mediaUpload, serve as mediaServe } from './routes/media.js';
import { refreshProvider } from './lib/whatsapp-connection.js';
import { ProviderError } from './providers/errors.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  // API answers are personal and change all the time: no ETags, and browsers must never keep a copy.
  // (A cached /api/auth/me left signed-in browsers on an endless spinner after a reload.)
  app.set('etag', false);
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin.split(',').map((s) => s.trim()), credentials: true }));
  // Keep the raw body: Meta signs the exact bytes it sends.
  app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(cookieParser());

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));
  // Use the shop's own WhatsApp account once the owner has connected it and switched it on.
  app.use(async (req, res, next) => {
    await refreshProvider().catch((err) => console.warn('[whatsapp] could not read the connection:', err.message));
    next();
  });
  app.use('/webhooks', webhookRoutes);
  app.use('/media', mediaServe);
  app.use('/api/auth', authRoutes);
  app.use('/api/customers', requireAuth, customerRoutes);
  app.use('/api/templates', requireAuth, templateRoutes);
  app.use('/api/campaigns', requireAuth, campaignRoutes);
  app.use('/api/inbox', requireAuth, inboxRoutes);
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api/occasions', requireAuth, occasionRoutes);
  app.use('/api/leads', requireAuth, leadRoutes);
  app.use('/api/offers', requireAuth, offerRoutes);
  app.use('/api/whatsapp', requireAuth, whatsappRoutes);
  app.use('/api/export', requireAuth, exportRoutes);
  app.use('/api/media', mediaUpload);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Express 5 passes errors from async handlers here.
  app.use((err, req, res, _next) => {
    // A refusal from WhatsApp (Meta), Twilio or the SMS gateway: show their reason, not a generic error.
    const fromProvider = err instanceof ProviderError;
    const status = err.status || err.statusCode || (fromProvider ? 502 : 500);
    if (status >= 500) console.error(err);
    const message = err.expose || fromProvider || status < 500 ? err.message : 'Something went wrong on our side. Please try again.';
    res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (15 MB limit).' : message });
  });
  return app;
}
