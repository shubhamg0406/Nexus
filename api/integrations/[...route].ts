import express from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { createSharedIntegrationsRouter } from '../../src/server/integrations/sharedRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/integrations', createSharedIntegrationsRouter());

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
