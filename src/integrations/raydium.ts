import nodeFetch from 'node-fetch';

if (!globalThis.fetch) {
  // @ts-ignore
  globalThis.fetch = nodeFetch;
}

import { NATIVE_MINT } from '@solana/spl-token';
import {
  Raydium,
  TxVersion,
  CurveCalculator,
  FeeOn,
} from '@raydium-io/raydium-sdk-v2';
import type {
  ApiV3PoolInfoStandardItemCpmm,
  CpmmKeys,
  CpmmParsedRpcData,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import type { DexConfig, SwapQuote, SwapResult, PoolInfo } from '../types.ts';

let raydiumInstance: Raydium | null = null;

export async function initializeRaydium(config: DexConfig): Promise<Raydium> {
  if (raydiumInstance) {
    return raydiumInstance;
  }

  raydiumInstance = await Raydium.load({
    owner: config.owner,
    connection: config.connection,
    cluster: config.cluster,
    disableFeatureCheck: true,
    disableLoadToken: false,
  });

  return raydiumInstance;
}

export function getRaydiumInstance(): Raydium {
  if (!raydiumInstance) {
    throw new Error('Raydium not initialized. Call initializeRaydium() first.');
  }
  return raydiumInstance;
}

export async function findRaydiumPoolByToken(tokenMint: string): Promise<string | null> {
  const raydium = getRaydiumInstance();

  try {
    if (raydium.cluster === 'mainnet') {
      const poolsData = await raydium.api.fetchPoolByMints({
        mint1: tokenMint,
        mint2: NATIVE_MINT.toBase58(),
      });

      const pools: any[] = Array.isArray(poolsData) ? poolsData : (poolsData as any).data || [];
      const cpmmPools = pools.filter(
        (pool: any) => pool.programId === 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'
      );
      return cpmmPools.length > 0 ? cpmmPools[0].id : null;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error finding Raydium pool:', error);
    return null;
  }
}

export async function checkRaydiumPoolExists(poolId: string): Promise<PoolInfo> {
  const raydium = getRaydiumInstance();

  try {
    if (raydium.cluster === 'mainnet') {
      const data = await raydium.api.fetchPoolById({ ids: poolId });
      if (data && data.length > 0) {
        const pool = data[0] as ApiV3PoolInfoStandardItemCpmm;
        return {
          poolId: pool.id,
          tokenAMint: pool.mintA.address,
          tokenBMint: pool.mintB.address,
          exists: true,
        };
      }
    } else {
      const data = await raydium.cpmm.getPoolInfoFromRpc(poolId);
      if (data.poolInfo) {
        return {
          poolId: data.poolInfo.id,
          tokenAMint: data.poolInfo.mintA.address,
          tokenBMint: data.poolInfo.mintB.address,
          exists: true,
        };
      }
    }
  } catch (error) {
    console.error('Error checking Raydium pool:', error);
  }

  return {
    poolId,
    tokenAMint: '',
    tokenBMint: '',
    exists: false,
  };
}

export async function getRaydiumSwapQuote(
  poolId: string,
  inputMint: string,
  inputAmount: BN,
  slippage: number = 0.01
): Promise<SwapQuote> {
  const raydium = getRaydiumInstance();

  let poolInfo: ApiV3PoolInfoStandardItemCpmm;
  let rpcData: CpmmParsedRpcData;

  if (raydium.cluster === 'mainnet') {
    const data = await raydium.api.fetchPoolById({ ids: poolId });
    poolInfo = data[0] as ApiV3PoolInfoStandardItemCpmm;
    rpcData = await raydium.cpmm.getRpcPoolInfo(poolInfo.id, true);
  } else {
    const data = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    poolInfo = data.poolInfo;
    rpcData = data.rpcData;
  }

  if (inputMint !== poolInfo.mintA.address && inputMint !== poolInfo.mintB.address) {
    throw new Error('Input mint does not match pool');
  }

  const baseIn = inputMint === poolInfo.mintA.address;

  const swapResult = CurveCalculator.swapBaseInput(
    inputAmount,
    baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
    baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
    rpcData.configInfo!.tradeFeeRate,
    rpcData.configInfo!.creatorFeeRate,
    rpcData.configInfo!.protocolFeeRate,
    rpcData.configInfo!.fundFeeRate,
    rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB
  );

  const priceImpact = calculatePriceImpact(
    inputAmount,
    swapResult.outputAmount,
    baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
    baseIn ? rpcData.quoteReserve : rpcData.baseReserve
  );

  const minOutputAmount = swapResult.outputAmount
    .mul(new BN(Math.floor((1 - slippage) * 10000)))
    .div(new BN(10000));

  return {
    dex: 'raydium',
    poolId,
    inputAmount: swapResult.inputAmount,
    outputAmount: swapResult.outputAmount,
    tradeFee: swapResult.tradeFee,
    priceImpact,
    minOutputAmount,
  };
}

export async function executeRaydiumSwap(
  poolId: string,
  inputMint: string,
  inputAmount: BN,
  slippage: number = 0.01
): Promise<SwapResult> {
  const raydium = getRaydiumInstance();

  let poolInfo: ApiV3PoolInfoStandardItemCpmm;
  let poolKeys: CpmmKeys | undefined;
  let rpcData: CpmmParsedRpcData;

  if (raydium.cluster === 'mainnet') {
    const data = await raydium.api.fetchPoolById({ ids: poolId });
    poolInfo = data[0] as ApiV3PoolInfoStandardItemCpmm;
    rpcData = await raydium.cpmm.getRpcPoolInfo(poolInfo.id, true);
  } else {
    const data = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    poolInfo = data.poolInfo;
    poolKeys = data.poolKeys;
    rpcData = data.rpcData;
  }

  if (inputMint !== poolInfo.mintA.address && inputMint !== poolInfo.mintB.address) {
    throw new Error('Input mint does not match pool');
  }

  const baseIn = inputMint === poolInfo.mintA.address;

  const swapResult = CurveCalculator.swapBaseInput(
    inputAmount,
    baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
    baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
    rpcData.configInfo!.tradeFeeRate,
    rpcData.configInfo!.creatorFeeRate,
    rpcData.configInfo!.protocolFeeRate,
    rpcData.configInfo!.fundFeeRate,
    rpcData.feeOn === FeeOn.BothToken || rpcData.feeOn === FeeOn.OnlyTokenB
  );

  const swapParams: any = {
    poolInfo,
    inputAmount,
    swapResult,
    slippage,
    baseIn,
    txVersion: TxVersion.V0,
  };

  if (poolKeys) {
    swapParams.poolKeys = poolKeys;
  }

  const { execute } = await raydium.cpmm.swap(swapParams);

  const { txId } = await execute({ sendAndConfirm: true });

  const cluster = raydium.cluster === 'devnet' ? '?cluster=devnet' : '';
  const explorerUrl = `https://explorer.solana.com/tx/${txId}${cluster}`;

  return {
    txId,
    inputAmount: inputAmount.toString(),
    outputAmount: swapResult.outputAmount.toString(),
    explorerUrl,
  };
}

function calculatePriceImpact(
  inputAmount: BN,
  outputAmount: BN,
  inputReserve: BN,
  outputReserve: BN
): number {
  const spotPrice = outputReserve.toNumber() / inputReserve.toNumber();
  const executionPrice = outputAmount.toNumber() / inputAmount.toNumber();
  const priceImpact = Math.abs((executionPrice - spotPrice) / spotPrice) * 100;
  return priceImpact;
}
