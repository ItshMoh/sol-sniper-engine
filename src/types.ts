import BN from 'bn.js';
import { Connection, Keypair } from '@solana/web3.js';

export interface DexConfig {
  connection: Connection;
  owner: Keypair;
  cluster: 'mainnet' | 'devnet';
}

export interface SwapQuote {
  dex: 'raydium' | 'meteora';
  poolId: string;
  inputAmount: BN;
  outputAmount: BN;
  tradeFee: BN;
  priceImpact: number;
  minOutputAmount: BN;
}

export interface SwapResult {
  txId: string;
  inputAmount: string;
  outputAmount: string;
  explorerUrl: string;
}

export interface PoolInfo {
  poolId: string;
  tokenAMint: string;
  tokenBMint: string;
  exists: boolean;
}
