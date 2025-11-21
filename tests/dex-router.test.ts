import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals';
import BN from 'bn.js';

type CheckRaydiumPoolExists = typeof import('../src/integrations/raydium.ts')['checkRaydiumPoolExists'];
type GetRaydiumSwapQuote = typeof import('../src/integrations/raydium.ts')['getRaydiumSwapQuote'];
type CheckMeteoraPoolExists = typeof import('../src/integrations/meteora.ts')['checkMeteoraPoolExists'];
type GetMeteoraSwapQuote = typeof import('../src/integrations/meteora.ts')['getMeteoraSwapQuote'];

const mockCheckRaydiumPoolExists = jest.fn() as jest.MockedFunction<CheckRaydiumPoolExists>;
const mockGetRaydiumSwapQuote = jest.fn() as jest.MockedFunction<GetRaydiumSwapQuote>;
const mockCheckMeteoraPoolExists = jest.fn() as jest.MockedFunction<CheckMeteoraPoolExists>;
const mockGetMeteoraSwapQuote = jest.fn() as jest.MockedFunction<GetMeteoraSwapQuote>;

const raydiumModulePromise = jest.unstable_mockModule('../src/integrations/raydium.ts', () => ({
  checkRaydiumPoolExists: mockCheckRaydiumPoolExists,
  getRaydiumSwapQuote: mockGetRaydiumSwapQuote,
  executeRaydiumSwap: jest.fn(),
}));

const meteoraModulePromise = jest.unstable_mockModule('../src/integrations/meteora.ts', () => ({
  checkMeteoraPoolExists: mockCheckMeteoraPoolExists,
  getMeteoraSwapQuote: mockGetMeteoraSwapQuote,
  executeMeteoraSwap: jest.fn(),
}));

type DexRouterModule = typeof import('../src/services/dex-router.ts');
let checkForPool: DexRouterModule['checkForPool'];
let getBestRoute: DexRouterModule['getBestRoute'];

beforeAll(async () => {
  await raydiumModulePromise;
  await meteoraModulePromise;
  const module = await import('../src/services/dex-router.ts');
  checkForPool = module.checkForPool;
  getBestRoute = module.getBestRoute;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckRaydiumPoolExists.mockReset();
  mockCheckMeteoraPoolExists.mockReset();
  mockGetRaydiumSwapQuote.mockReset();
  mockGetMeteoraSwapQuote.mockReset();

  mockCheckRaydiumPoolExists.mockResolvedValue({
    poolId: '',
    tokenAMint: '',
    tokenBMint: '',
    exists: false,
  });
  mockCheckMeteoraPoolExists.mockResolvedValue({
    poolId: '',
    tokenAMint: '',
    tokenBMint: '',
    exists: false,
  });
});

describe('DEX Router Tests', () => {
  describe('checkForPool', () => {
    it('should find Raydium pool when it exists', async () => {
      mockCheckRaydiumPoolExists.mockResolvedValue({
        exists: true,
        poolId: 'raydium-pool-123',
        tokenAMint: 'mint-a',
        tokenBMint: 'mint-b',
      });

      const result = await checkForPool('token-address-123');

      expect(result.found).toBe(true);
      expect(result.raydiumPoolId).toBe('raydium-pool-123');
    });

    it('should find Meteora pool when it exists', async () => {
      mockCheckMeteoraPoolExists.mockResolvedValue({
        exists: true,
        poolId: 'meteora-pool-456',
        tokenAMint: 'mint-a',
        tokenBMint: 'mint-b',
      });

      const result = await checkForPool('token-address-456');

      expect(result.found).toBe(true);
      expect(result.meteoraPoolId).toBe('meteora-pool-456');
    });

    it('should return not found when no pools exist', async () => {
      mockCheckRaydiumPoolExists.mockResolvedValue({
        exists: false,
        poolId: '',
        tokenAMint: '',
        tokenBMint: '',
      });
      mockCheckMeteoraPoolExists.mockResolvedValue({
        exists: false,
        poolId: '',
        tokenAMint: '',
        tokenBMint: '',
      });

      const result = await checkForPool('non-existent-token');

      expect(result.found).toBe(false);
      expect(result.raydiumPoolId).toBeNull();
      expect(result.meteoraPoolId).toBeNull();
    });
  });

  describe('getBestRoute', () => {
    it('should select Raydium when it has better output', async () => {
      mockGetRaydiumSwapQuote.mockResolvedValue({
        dex: 'raydium',
        poolId: 'raydium-pool',
        inputAmount: new BN('10000000'),
        outputAmount: new BN('10000000'),
        minOutputAmount: new BN('9900000'),
        tradeFee: new BN('250000'),
        priceImpact: 5.0,
      });

      mockGetMeteoraSwapQuote.mockResolvedValue({
        dex: 'meteora',
        poolId: 'meteora-pool',
        inputAmount: new BN('10000000'),
        outputAmount: new BN('9000000'),
        minOutputAmount: new BN('8900000'),
        tradeFee: new BN('200000'),
        priceImpact: 4.5,
      });

      const order = { amountIn: '100000000', slippage: '0.01' };
      const result = await getBestRoute(order, 'raydium-pool', 'meteora-pool');

      expect(result.dex).toBe('raydium');
      expect(result.reason).toContain('Better output');
    });

    it('should select Meteora when it has better output', async () => {
      mockGetRaydiumSwapQuote.mockResolvedValue({
        dex: 'raydium',
        poolId: 'raydium-pool',
        inputAmount: new BN('10000000'),
        outputAmount: new BN('9000000'),
        minOutputAmount: new BN('8800000'),
        tradeFee: new BN('250000'),
        priceImpact: 5.0,
      });

      mockGetMeteoraSwapQuote.mockResolvedValue({
        dex: 'meteora',
        poolId: 'meteora-pool',
        inputAmount: new BN('10000000'),
        outputAmount: new BN('10000000'),
        minOutputAmount: new BN('9800000'),
        tradeFee: new BN('200000'),
        priceImpact: 4.5,
      });

      const order = { amountIn: '100000000', slippage: '0.01' };
      const result = await getBestRoute(order, 'raydium-pool', 'meteora-pool');

      expect(result.dex).toBe('meteora');
      expect(result.reason).toContain('Better output');
    });

    it('should handle when only Raydium is available', async () => {
      mockGetRaydiumSwapQuote.mockResolvedValue({
        dex: 'raydium',
        poolId: 'raydium-pool',
        inputAmount: new BN('10000000'),
        outputAmount: new BN('10000000'),
        minOutputAmount: new BN('9900000'),
        tradeFee: new BN('250000'),
        priceImpact: 5.0,
      });

      mockGetMeteoraSwapQuote.mockRejectedValue(new Error('Pool not found'));

      const order = { amountIn: '100000000', slippage: '0.01' };
      const result = await getBestRoute(order, 'raydium-pool', null);

      expect(result.dex).toBe('raydium');
      expect(result.reason).toBe('Only Raydium available');
    });

    it('should handle when only Meteora is available', async () => {
      mockGetRaydiumSwapQuote.mockRejectedValue(new Error('Pool not found'));

      mockGetMeteoraSwapQuote.mockResolvedValue({
        dex: 'meteora',
        poolId: 'meteora-pool',
        inputAmount: new BN('10000000'),
        outputAmount: new BN('10000000'),
        minOutputAmount: new BN('9800000'),
        tradeFee: new BN('200000'),
        priceImpact: 4.5,
      });

      const order = { amountIn: '100000000', slippage: '0.01' };
      const result = await getBestRoute(order, null, 'meteora-pool');

      expect(result.dex).toBe('meteora');
      expect(result.reason).toBe('Only Meteora available');
    });

    it('should throw error when no DEX is available', async () => {
      mockGetRaydiumSwapQuote.mockRejectedValue(new Error('Pool not found'));
      mockGetMeteoraSwapQuote.mockRejectedValue(new Error('Pool not found'));

      const order = { amountIn: '100000000', slippage: '0.01' };

      await expect(getBestRoute(order, null, null)).rejects.toThrow(
        'No quotes available from any DEX'
      );
    });
  });
});
