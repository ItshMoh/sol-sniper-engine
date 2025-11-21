import { Pool } from 'pg';
import { CONFIG } from '../config/index.ts';
import logger from '../utils/logger.ts';

export const pgPool = new Pool(CONFIG.database);

export async function initDatabase() {
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY,
        status VARCHAR(20) NOT NULL,
        token_address VARCHAR(50) NOT NULL,
        amount_in NUMERIC NOT NULL,
        slippage NUMERIC NOT NULL,
        selected_dex VARCHAR(20),
        tx_hash VARCHAR(100),
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    `);
    logger.info('Database initialized');
  } catch (error) {
    logger.error({ err: error as Error }, 'Database initialization error');
  } finally {
    client.release();
  }
}

export async function createOrder(orderId: string, orderData: any) {
  await pgPool.query(
    `INSERT INTO orders (id, status, token_address, amount_in, slippage)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, 'pending', orderData.tokenAddress, orderData.amountIn, orderData.slippage]
  );
}

export async function updateOrderStatus(orderId: string, status: string, data: any = {}) {
  const fields: string[] = ['status = $2', 'updated_at = NOW()'];
  const values: any[] = [orderId, status];
  let paramCount = 3;

  if (data.selectedDex) {
    fields.push(`selected_dex = $${paramCount}`);
    values.push(data.selectedDex);
    paramCount++;
  }

  if (data.txHash) {
    fields.push(`tx_hash = $${paramCount}`);
    values.push(data.txHash);
    paramCount++;
  }

  if (data.errorMessage) {
    fields.push(`error_message = $${paramCount}`);
    values.push(data.errorMessage);
    paramCount++;
  }

  await pgPool.query(
    `UPDATE orders SET ${fields.join(', ')} WHERE id = $1`,
    values
  );
}
