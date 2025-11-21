import fs from 'fs';
import bs58 from 'bs58';

// Read the keypair file
const keypairPath = process.env.HOME + '/.config/solana/id.json';
const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));

// Convert to Uint8Array if needed
const secretKey = Uint8Array.from(keypairData);

// Convert to base58 string
const base58Key = bs58.encode(secretKey);

console.log('\n=== Solana Wallet Export ===');
console.log('Wallet Address:', process.argv[2] || 'ADF6aWqnfuvgto8RtshA2TiTzzmeHm8j8CvxJQKL7b4Z');
console.log('\nPrivate Key (base58):');
console.log(base58Key);
console.log('\n⚠️  IMPORTANT: Add this to your .env file as WALLET_PRIVATE_KEY');
console.log('⚠️  NEVER commit this to git!');
console.log('========================\n');
