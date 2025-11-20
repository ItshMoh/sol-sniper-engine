import nodeFetch from 'node-fetch';

// @ts-ignore - Polyfill fetch for Node.js
if (!globalThis.fetch) {
  // @ts-ignore
  globalThis.fetch = nodeFetch;
}

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import type { ApiCpmmConfigInfo } from '@raydium-io/raydium-sdk-v2';
import { Raydium, TxVersion, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2';
import fs from 'fs';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import BN from 'bn.js';

dotenv.config();

interface TokenInfo {
  name: string;
  mint: string;
  tokenAccount: string;
  decimals: number;
  supply: number;
}

interface TestTokens {
  token1: TokenInfo;
  token2: TokenInfo;
  token3: TokenInfo;
}

const NATIVE_SOL = {
  mint: new PublicKey('So11111111111111111111111111111111111111112'),
  decimals: 9,
};

let cachedCpmmConfig: ApiCpmmConfigInfo | undefined;

async function getDefaultCpmmConfig(raydium: Raydium): Promise<ApiCpmmConfigInfo> {
  if (cachedCpmmConfig) {
    return cachedCpmmConfig;
  }

  const configs = await raydium.api.getCpmmConfigs();

  if (!configs || configs.length === 0) {
    throw new Error('Unable to fetch CPMM configs from Raydium API');
  }

  // For devnet, convert config IDs to devnet PDAs
  if (raydium.cluster === 'devnet') {
    configs.forEach((config) => {
      config.id = getCpmmPdaAmmConfigId(
        DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
        config.index
      ).publicKey.toBase58();
    });
  }

  // Use the config with the lowest trade fee to make pools cheaper by default.
  const sorted = [...configs].sort(
    (a, b) => a.tradeFeeRate - b.tradeFeeRate
  );

  const selectedConfig = sorted[0];

  if (!selectedConfig) {
    throw new Error('Failed to select a CPMM config');
  }

  cachedCpmmConfig = selectedConfig;

  console.log(
    `Using CPMM config ${selectedConfig.id} (trade fee ${selectedConfig.tradeFeeRate})`
  );

  return selectedConfig;
}

async function createCpmmPool(
  raydium: Raydium,
  connection: Connection,
  owner: Keypair,
  tokenInfo: TokenInfo,
  tokenAmount: number,
  solAmount: number,
  feeConfig: ApiCpmmConfigInfo
) {
  console.log(`\nCreating CPMM pool for ${tokenInfo.name}/SOL...`);
  console.log(`  Token amount: ${tokenAmount} ${tokenInfo.name}`);
  console.log(`  SOL amount: ${solAmount} SOL`);

  try {
    const mintAPubkey = new PublicKey(tokenInfo.mint);
    const mintBPubkey = NATIVE_SOL.mint;

    // Ensure token account exists for the owner
    console.log(`  Ensuring token account exists...`);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      owner,
      mintAPubkey,
      owner.publicKey
    );
    console.log(`  Token account: ${tokenAccount.address.toBase58()}`);

    // Token amounts (with decimals)
    const mintAAmount = new BN(tokenAmount)
      .mul(new BN(10).pow(new BN(tokenInfo.decimals)));
    const mintBAmount = new BN(solAmount)
      .mul(new BN(10).pow(new BN(NATIVE_SOL.decimals)));

    console.log(`  Creating pool transaction...`);

    // Create pool using Raydium SDK V2
    const { execute, extInfo } = await raydium.cpmm.createPool({
      programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
      mintA: {
        address: mintAPubkey.toBase58(),
        decimals: tokenInfo.decimals,
        programId: TOKEN_PROGRAM_ID.toBase58(),
      },
      mintB: {
        address: mintBPubkey.toBase58(),
        decimals: NATIVE_SOL.decimals,
        programId: TOKEN_PROGRAM_ID.toBase58(),
      },
      mintAAmount,
      mintBAmount,
      startTime: new BN(0), // Start immediately
      associatedOnly: false,
      checkCreateATAOwner: false,
      ownerInfo: {
        feePayer: owner.publicKey,
        useSOLBalance: true,
      },
      feeConfig,
      txVersion: TxVersion.V0,
    });

    console.log(`  Executing transaction...`);

    const { txId } = await execute({ sendAndConfirm: true });

    console.log(`  Pool created!`);
    console.log(`  Transaction: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
    const poolId = extInfo.address.poolId.toBase58();
    console.log(`  Pool ID: ${poolId}`);

    return {
      name: tokenInfo.name,
      poolId,
      tokenMint: tokenInfo.mint,
      solMint: NATIVE_SOL.mint.toBase58(),
      txHash: txId,
      tokenAmount,
      solAmount,
    };

  } catch (error: any) {
    console.error(`  Failed to create pool for ${tokenInfo.name}:`, error.message);
    throw error;
  }
}

async function main() {
  console.log('\n=== Creating Raydium CPMM Pools on Devnet ===\n');

  const privateKey = process.env.WALLET_PRIVATE_KEY!;
  const secretKey = bs58.decode(privateKey);
  const owner = Keypair.fromSecretKey(secretKey);

  // Try multiple RPC endpoints
  const rpcEndpoints = [
    'https://api.devnet.solana.com',
    'https://devnet.helius-rpc.com/?api-key=public',
    'https://rpc.ankr.com/solana_devnet',
  ];

  let connection: Connection | null = null;
  let balance = 0;

  for (const endpoint of rpcEndpoints) {
    try {
      console.log(`Trying RPC: ${endpoint}`);
      const testConnection = new Connection(endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
      });

      console.log(`Wallet: ${owner.publicKey.toBase58()}`);

      balance = await testConnection.getBalance(owner.publicKey);
      console.log(`Balance: ${balance / 10**9} SOL`);

      connection = testConnection;
      break;
    } catch (error: any) {
      console.log(`Failed with ${endpoint}: ${error.message}`);
      if (rpcEndpoints.indexOf(endpoint) === rpcEndpoints.length - 1) {
        throw new Error('All RPC endpoints failed. Check your internet connection.');
      }
      continue;
    }
  }

  if (!connection) {
    throw new Error('Could not establish connection to any RPC endpoint');
  }

  if (balance < 5 * 10**9) {
    console.error('\nInsufficient SOL balance. Need at least 5 SOL for creating 3 pools.');
    console.log('Run: solana airdrop 2 (multiple times)');
    console.log('Or use: https://faucet.solana.com/');
    process.exit(1);
  }

  // Load token information
  const tokens: TestTokens = JSON.parse(
    fs.readFileSync('test-tokens.json', 'utf-8')
  );

  // Initialize Raydium SDK
  console.log('\nInitializing Raydium SDK...');
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: 'devnet',
    disableFeatureCheck: true,
    disableLoadToken: false,
  });

  console.log('Raydium SDK initialized');

  const feeConfig = await getDefaultCpmmConfig(raydium);

  // Create pools for each token
  const poolResults = [];

  // Pool 1: SNIPE1/SOL
  console.log('\n--- Pool 1/3 ---');
  const pool1 = await createCpmmPool(
    raydium,
    connection,
    owner,
    tokens.token1,
    100000, // 100k tokens
    1,       // 1 SOL
    feeConfig
  );
  poolResults.push(pool1);
  await sleep(3000);

  // Pool 2: SNIPE2/SOL
  console.log('\n--- Pool 2/3 ---');
  const pool2 = await createCpmmPool(
    raydium,
    connection,
    owner,
    tokens.token2,
    100000, // 100k tokens
    1,       // 1 SOL
    feeConfig
  );
  poolResults.push(pool2);
  await sleep(3000);

  // Pool 3: SNIPE3/SOL
  console.log('\n--- Pool 3/3 ---');
  const pool3 = await createCpmmPool(
    raydium,
    connection,
    owner,
    tokens.token3,
    100000, // 100k tokens
    1,       // 1 SOL
    feeConfig
  );
  poolResults.push(pool3);

  // Save pool information
  const poolData = {
    pool1: poolResults[0],
    pool2: poolResults[1],
    pool3: poolResults[2],
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    'test-pools.json',
    JSON.stringify(poolData, null, 2)
  );

  console.log('\n=== All Pools Created Successfully ===\n');
  console.log('Pool information saved to test-pools.json\n');

  poolResults.forEach((pool, i) => {
    console.log(`${pool.name}/SOL Pool:`);
    console.log(`  Pool ID: ${pool.poolId}`);
    console.log(`  TX: https://explorer.solana.com/tx/${pool.txHash}?cluster=devnet`);
    console.log('');
  });

  console.log('Next steps:');
  console.log('1. Wait for transactions to confirm');
  console.log('2. Verify pools on Solana Explorer');
  console.log('3. Implement real pool detection in src/index.ts');
  console.log('');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
