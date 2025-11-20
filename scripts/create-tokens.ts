import {
  Connection,
  Keypair
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import fs from 'fs';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

async function createTestToken(
  connection: Connection,
  payer: Keypair,
  name: string
) {
  console.log(`\n Creating ${name}...`);

  // Create mint
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,  // mint authority
    payer.publicKey,  // freeze authority
    9                 // decimals
  );

  console.log(` Mint Address: ${mint.toBase58()}`);

  // Create token account
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );

  console.log(`   Token Account: ${tokenAccount.address.toBase58()}`);

  // Mint 1,000,000 tokens
  const mintAmount = 1_000_000 * 10**9; // 1M tokens with 9 decimals
  await mintTo(
    connection,
    payer,
    mint,
    tokenAccount.address,
    payer,
    mintAmount
  );

  console.log(`  Minted 1,000,000 ${name}`);

  return {
    name,
    mint: mint.toBase58(),
    tokenAccount: tokenAccount.address.toBase58(),
    decimals: 9,
    supply: 1000000
  };
}

async function main() {
  console.log('\n=== Creating Test Tokens on Devnet ===\n');

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    'confirmed'
  );

  // Load wallet from private key
  const privateKey = process.env.WALLET_PRIVATE_KEY!;
  const secretKey = bs58.decode(privateKey);
  const payer = Keypair.fromSecretKey(secretKey);

  console.log(`Wallet: ${payer.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 10**9} SOL`);

  if (balance < 1 * 10**9) {
    console.error('\n Insufficient SOL balance. Need at least 1 SOL.');
    console.log('Run: solana airdrop 2');
    process.exit(1);
  }

  // Create 3 test tokens
  const token1 = await createTestToken(connection, payer, 'SNIPE1');
  await sleep(2000);

  const token2 = await createTestToken(connection, payer, 'SNIPE2');
  await sleep(2000);

  const token3 = await createTestToken(connection, payer, 'SNIPE3');

  // Save token info
  const tokens = { token1, token2, token3 };

  fs.writeFileSync(
    'test-tokens.json',
    JSON.stringify(tokens, null, 2)
  );

  console.log('\n All tokens created and saved to test-tokens.json\n');
  console.log(`  ${token1.name}: ${token1.mint}`);
  console.log(`  ${token2.name}: ${token2.mint}`);
  console.log(`  ${token3.name}: ${token3.mint}`);
  console.log('');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
