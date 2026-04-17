import type { FastifyInstance } from 'fastify';
import type { WeatherProvider } from '../weather/provider.js';
import { encodeGridSubset } from '../weather/binary-encoder.js';

export function registerWeatherRoutes(app: FastifyInstance, getProvider: () => WeatherProvider) {
  app.get('/api/v1/weather/status', async (_req, reply) => {
    const provider = getProvider();
    const statusMap = { stable: 0, blending: 1, delayed: 2 } as const;
    return reply.send({
      run: provider.runTs,
      next: provider.nextRunExpectedUtc,
      status: statusMap[provider.blendStatus],
      alpha: provider.blendAlpha,
    });
  });

  app.get<{ Querystring: { bounds?: string; hours?: string } }>(
    '/api/v1/weather/grid',
    async (req, reply) => {
      const provider = getProvider();
      const grid = provider.getGrid();

      const boundsStr = req.query.bounds ?? `${grid.bbox.latMin},${grid.bbox.lonMin},${grid.bbox.latMax},${grid.bbox.lonMax}`;
      const parts = boundsStr.split(',').map(Number);
      if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
        return reply.status(400).send({ error: 'invalid bounds' });
      }
      const [latMin, lonMin, latMax, lonMax] = parts;

      const hoursStr = req.query.hours ?? '0';
      const hours = hoursStr.split(',').map(Number).filter(h => grid.forecastHours.includes(h));
      if (hours.length === 0) {
        return reply.status(400).send({ error: 'no valid forecast hours' });
      }

      const statusMap = { stable: 0, blending: 1, delayed: 2 } as const;
      const maxAge = provider.blendStatus === 'blending' ? 60 : 300;

      const buf = encodeGridSubset(grid, {
        bounds: { latMin: latMin!, latMax: latMax!, lonMin: lonMin!, lonMax: lonMax! },
        hours,
        runTimestamp: provider.runTs,
        nextRunExpectedUtc: provider.nextRunExpectedUtc,
        weatherStatus: statusMap[provider.blendStatus],
        blendAlpha: provider.blendAlpha,
      });

      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Cache-Control', `public, max-age=${maxAge}`)
        .send(Buffer.from(buf));
    },
  );
}
