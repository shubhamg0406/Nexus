import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildRequireFirebaseUser } from './requireFirebaseUser.js';

describe('requireFirebaseUser middleware', () => {
  it('rejects when bearer token is missing', async () => {
    const app = express();
    app.get('/protected', buildRequireFirebaseUser(async () => ({ uid: 'uid-1' })), (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(app).get('/protected');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('attaches verified firebase user to request', async () => {
    const verifyToken = vi.fn(async () => ({ uid: 'uid-42', email: 'user@example.com', name: 'Nexus User' }));
    const app = express();
    app.get('/protected', buildRequireFirebaseUser(verifyToken), (req, res) => {
      res.json({ uid: req.user?.uid, email: req.user?.email });
    });

    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ uid: 'uid-42', email: 'user@example.com' });
    expect(verifyToken).toHaveBeenCalledWith('test-token');
  });
});
