import express from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { createUpstoxRouter } from '../../../src/server/providers/upstox/upstoxRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/connections/upstox', createUpstoxRouter());
app.use('/api/upstox', createUpstoxRouter());

export default function handler(req: IncomingMessage, res: ServerResponse) {
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
