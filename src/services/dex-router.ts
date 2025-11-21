import BN from 'bn.js';
import {
  checkRaydiumPoolExists,
  getRaydiumSwapQuote,
  executeRaydiumSwap,
} from '../integrations/raydium.ts';
import {
  checkMeteoraPoolExists,
  getMeteoraSwapQuote,
  executeMeteoraSwap,
} from '../integrations/meteora.ts';
import logger from '../utils/logger.ts';

export async function checkForPool(tokenAddress: string): Promise<{
  found: boolean;
  raydiumPoolId: string | null;
  meteoraPoolId: string | null
}> {
  logger.info(`Checking for pools for token: ${tokenAddress}`);

  let raydiumPoolId: string | null = null;
  let meteoraPoolId: string | null = null;

  // Check test-pools.json for known pools
  const fs = await import('fs');
  try {
    const poolsData = JSON.parse(fs.readFileSync('test-pools.json', 'utf-8'));

    // Check for Raydium pools
    for (const [key, pool] of Object.entries(poolsData)) {
      if (key.startsWith('raydium-pool')) {
        const poolInfo: any = pool;
        if (poolInfo.tokenMint === tokenAddress) {
          raydiumPoolId = poolInfo.poolId;
          logger.info(`Raydium pool found: ${raydiumPoolId}`);
        }
      }
    }

    // Check for Meteora pools
    for (const [key, pool] of Object.entries(poolsData)) {
      if (key.startsWith('meteora-pool')) {
        const poolInfo: any = pool;
        if (poolInfo.tokenMint === tokenAddress) {
          meteoraPoolId = poolInfo.poolId;
          logger.info(`Meteora pool found: ${meteoraPoolId}`);
        }
      }
    }
  } catch (error) {
    logger.info('No test-pools.json found, checking blockchain...');
  }

  // If not found in file, check blockchain
  if (!raydiumPoolId) {
    const raydiumPoolInfo = await checkRaydiumPoolExists(tokenAddress);
    if (raydiumPoolInfo.exists) {
      raydiumPoolId = raydiumPoolInfo.poolId;
      logger.info(`Raydium pool found on-chain: ${raydiumPoolId}`);
    }
  }

  if (!meteoraPoolId) {
    const meteoraPoolInfo = await checkMeteoraPoolExists(tokenAddress);
    if (meteoraPoolInfo.exists) {
      meteoraPoolId = meteoraPoolInfo.poolId;
      logger.info(`Meteora pool found on-chain: ${meteoraPoolId}`);
    }
  }

  const found = raydiumPoolId !== null || meteoraPoolId !== null;

  if (!found) {
    logger.warn('No pools found on any DEX');
  }

  return { found, raydiumPoolId, meteoraPoolId };
}

export async function getBestRoute(order: any, raydiumPoolId: string | null, meteoraPoolId: string | null) {
  logger.info('Getting quotes from DEXs...');

  const inputAmount = new BN(order.amountIn);
  const slippage = parseFloat(order.slippage);

  let raydiumQuote, meteoraQuote;

  // Get Raydium quote
  if (raydiumPoolId) {
    try {
      raydiumQuote = await getRaydiumSwapQuote(raydiumPoolId, 'So11111111111111111111111111111111111111112', inputAmount, slippage);
      logger.info(`Raydium: ${raydiumQuote.outputAmount.toString()} tokens (fee: ${raydiumQuote.tradeFee.toString()}, impact: ${raydiumQuote.priceImpact.toFixed(2)}%)`);
    } catch (error: any) {
      logger.warn(`Raydium quote failed: ${error.message}`);
    }
  } else {
    logger.info('Raydium: No pool available');
  }

  // Get Meteora quote
  if (meteoraPoolId) {
    try {
      meteoraQuote = await getMeteoraSwapQuote(meteoraPoolId, 'So11111111111111111111111111111111111111112', inputAmount, slippage);
      logger.info(`Meteora: ${meteoraQuote.outputAmount.toString()} tokens (fee: ${meteoraQuote.tradeFee.toString()}, impact: ${meteoraQuote.priceImpact.toFixed(2)}%)`);
    } catch (error: any) {
      logger.warn(`Meteora quote failed: ${error.message}`);
    }
  } else {
    logger.info('Meteora: No pool available');
  }

  // Select best route based on output amount
  if (!raydiumQuote && !meteoraQuote) {
    throw new Error('No quotes available from any DEX');
  }

  let selectedDex: string;
  let selectedPoolId: string;
  let reason: string;

  if (!meteoraQuote && raydiumQuote) {
    selectedDex = 'raydium';
    selectedPoolId = raydiumPoolId!;
    reason = 'Only Raydium available';
  } else if (!raydiumQuote && meteoraQuote) {
    selectedDex = 'meteora';
    selectedPoolId = meteoraPoolId!;
    reason = 'Only Meteora available';
  } else if (raydiumQuote && meteoraQuote) {
    const raydiumOutput = raydiumQuote.outputAmount.toNumber();
    const meteoraOutput = meteoraQuote.outputAmount.toNumber();

    if (raydiumOutput > meteoraOutput) {
      selectedDex = 'raydium';
      selectedPoolId = raydiumPoolId!;
      reason = `Better output: ${raydiumOutput.toLocaleString()} vs ${meteoraOutput.toLocaleString()}`;
    } else {
      selectedDex = 'meteora';
      selectedPoolId = meteoraPoolId!;
      reason = `Better output: ${meteoraOutput.toLocaleString()} vs ${raydiumOutput.toLocaleString()}`;
    }
  } else {
    throw new Error('Unexpected state: quotes exist but cannot select DEX');
  }

  logger.info(`Selected: ${selectedDex} (${reason})`);

  return {
    dex: selectedDex,
    poolId: selectedPoolId,
    raydiumQuote,
    meteoraQuote,
    selectedQuote: selectedDex === 'raydium' ? raydiumQuote : meteoraQuote,
    reason,
  };
}

export async function executeTransaction(route: any, order: any): Promise<string> {
  logger.info(`Executing swap on ${route.dex}...`);

  const inputAmount = new BN(order.amountIn);
  const slippage = parseFloat(order.slippage);

  if (route.dex === 'raydium') {
    const result = await executeRaydiumSwap(
      route.poolId,
      'So11111111111111111111111111111111111111112',
      inputAmount,
      slippage
    );

    logger.info(`Swap executed: ${result.txId}`);
    logger.info(`Explorer: ${result.explorerUrl}`);

    return result.txId;
  } else if (route.dex === 'meteora') {
    const result = await executeMeteoraSwap(
      route.poolId,
      'So11111111111111111111111111111111111111112',
      inputAmount,
      slippage
    );

    logger.info(`Swap executed: ${result.txId}`);
    logger.info(`Explorer: ${result.explorerUrl}`);

    return result.txId;
  } else {
    throw new Error(`Unknown DEX: ${route.dex}`);
  }
}
