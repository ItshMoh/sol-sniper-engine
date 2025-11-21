import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { pgPool } from '../services/database.ts';

export async function healthRoutes(fastify: FastifyInstance, redisConnection: Redis) {
  fastify.get('/health', async (request, reply) => {
    try {
      await pgPool.query('SELECT 1');
      await redisConnection.ping();

      return reply.send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          postgres: 'connected',
          redis: 'connected',
          queue: 'running',
        },
      });
    } catch (error: any) {
      return reply.code(503).send({
        status: 'unhealthy',
        error: error.message,
      });
    }
  });
}
