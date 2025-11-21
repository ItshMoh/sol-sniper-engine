import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { CONFIG } from '../config/index.ts';
import { updateOrderStatus } from './database.ts';
import { checkForPool, getBestRoute, executeTransaction } from './dex-router.ts';
import logger from '../utils/logger.ts';

// WebSocket connections storage (orderId -> WebSocket connections)
export const wsConnections = new Map<string, Set<any>>();

export function broadcastToOrder(orderId: string, message: any) {
  const connections = wsConnections.get(orderId);
  if (connections) {
    const messageStr = JSON.stringify(message);
    connections.forEach((ws) => {
      if (ws.readyState === 1) {
        // 1 = OPEN state for WebSocket
        ws.send(messageStr);
      }
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createOrderWorker(redisConnection: Redis) {
  const worker = new Worker(
    'sniper-orders',
    async (job) => {
      const { orderId, order } = job.data;

      logger.info(`Processing order ${orderId}`);

      try {
        // PENDING
        await updateOrderStatus(orderId, 'pending');
        broadcastToOrder(orderId, {
          orderId,
          status: 'pending',
          message: 'Order received and queued'
        });
        // Wait to allow WebSocket streaming to be visible in demo
        await sleep(1500);

        // MONITORING
        await updateOrderStatus(orderId, 'monitoring');
        broadcastToOrder(orderId, {
          orderId,
          status: 'monitoring',
          message: `Monitoring for pool creation: ${order.tokenAddress.slice(0, 8)}...`
        });
        logger.info(`Monitoring pool for token: ${order.tokenAddress}`);
        // Simulate pool monitoring delay (makes streaming visible)
        await sleep(2000);

        // Check for pool existence
        const poolCheck = await checkForPool(order.tokenAddress);

        if (!poolCheck.found) {
          throw new Error('Pool not found on any DEX');
        }

        // TRIGGERED
        await updateOrderStatus(orderId, 'triggered');
        broadcastToOrder(orderId, {
          orderId,
          status: 'triggered',
          message: 'Pool detected! Starting execution...'
        });
        logger.info(`Pool found for ${order.tokenAddress}`);
        await sleep(1500);

        // ROUTING
        await updateOrderStatus(orderId, 'routing');
        broadcastToOrder(orderId, {
          orderId,
          status: 'routing',
          message: 'Comparing Raydium and Meteora quotes...'
        });
        logger.info('Fetching quotes from DEXs...');
        await sleep(1000);

        const bestRoute = await getBestRoute(order, poolCheck.raydiumPoolId, poolCheck.meteoraPoolId);

        broadcastToOrder(orderId, {
          orderId,
          status: 'routing',
          message: `Best route selected: ${bestRoute.dex}`,
          routing: {
            raydium: bestRoute.raydiumQuote,
            meteora: bestRoute.meteoraQuote,
            selected: bestRoute.dex,
            reason: bestRoute.reason,
          }
        });
        // Wait after routing decision (important to see DEX comparison)
        await sleep(2000);

        // BUILDING
        await updateOrderStatus(orderId, 'building', { selectedDex: bestRoute.dex });
        broadcastToOrder(orderId, {
          orderId,
          status: 'building',
          message: `Building transaction on ${bestRoute.dex}...`,
          selectedDex: bestRoute.dex
        });
        logger.info(`Building transaction on ${bestRoute.dex}...`);
        // Transaction building delay
        await sleep(2000);
        await updateOrderStatus(orderId, 'submitted');
        broadcastToOrder(orderId, {
          orderId,
          status: 'submitted',
          message: 'Transaction submitted to blockchain...'
        });
        logger.info('Transaction submitted...');
        // just given 2seconds wait so that we could see all events in websocket stream
        await sleep(2000);

        // Execute real swap on chosen DEX (Raydium or Meteora)
        const txHash = await executeTransaction(bestRoute, order);
        // Wait for blockchain confirmation
        await sleep(3000);

        // CONFIRMED
        await updateOrderStatus(orderId, 'confirmed', { txHash });
        broadcastToOrder(orderId, {
          orderId,
          status: 'confirmed',
          message: 'Transaction confirmed!',
          txHash,
          explorerUrl: `https://explorer.solana.com/tx/${txHash}?cluster=devnet`
        });
        logger.info(`Transaction confirmed: ${txHash}`);

        return { success: true, txHash };

      } catch (error: any) {
        logger.error(`Order ${orderId} failed:`, error.message);

        await updateOrderStatus(orderId, 'failed', { errorMessage: error.message });
        broadcastToOrder(orderId, {
          orderId,
          status: 'failed',
          message: error.message,
          error: error.message
        });

        throw error; // Let BullMQ handle retry
      }
    },
    {
      connection: redisConnection,
      concurrency: CONFIG.queue.concurrency,
      limiter: {
        max: 100, // 100 jobs
        duration: 60000, // per minute
      },
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          // Exponential backoff: 2s, 4s, 8s
          return Math.pow(2, attemptsMade) * 1000;
        },
      },
    }
  );

  // Worker event listeners
  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error({ err: err as Error }, `Job ${job?.id} failed after ${job?.attemptsMade} attempts`);
  });

  return worker;
}
