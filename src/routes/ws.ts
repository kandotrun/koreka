import { Hono } from 'hono';
import type { Env } from '../env';

const ws = new Hono<{ Bindings: Env }>();

// GET /api/rooms/:code/ws - WebSocket upgrade
ws.get('/:code/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket upgrade', 426);
  }

  const code = c.req.param('code');
  const roomId = c.env.ROOM.idFromName(code);
  const roomObj = c.env.ROOM.get(roomId);

  // Forward the WebSocket upgrade to the Durable Object
  return roomObj.fetch(new Request('http://internal/ws', {
    headers: c.req.raw.headers,
  }));
});

export default ws;
