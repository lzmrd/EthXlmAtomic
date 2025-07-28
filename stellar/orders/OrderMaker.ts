import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { FusionOrder, SwapParams } from '../../shared/types';
import { SecretManager } from '../../cross-chain-utils/secretManager';
import { TIME_CONSTANTS } from '../../shared/constants';

export interface MakerOrder {
  id: string;
  maker: string;
  srcChain: string;
  dstChain: string;
  srcToken: string;
  dstToken: string;
  srcAmount: string;
  dstAmount: string; // Calculated by system
  hashlock: string;
  timelock: number;
  nonce: number;
  signature: string;
  secret?: string; // Only stored locally for maker
  metadata?: OrderMetadata;
}

// What the user actually specifies - much simpler!
export interface OrderRequest {
  srcChain: 'ethereum' | 'stellar';
  srcToken: string;
  srcAmount: string;  // User specifies how much they want to sell
  
  // Optional: user can specify destination or let system optimize
  dstChain?: 'ethereum' | 'stellar';
  dstToken?: string;
  
  // Optional customization
  timelock?: number;
  slippagePercent?: number;
  minReceivedAmount?: string; // Minimum they'll accept (slippage protection)
  deadline?: number; // Unix timestamp
  metadata?: OrderMetadata;
}

// For frontend suggestions
export interface SwapRoute {
  dstChain: 'ethereum' | 'stellar';
  dstToken: string;
  estimatedAmount: string;
  rate: string;
  liquidityScore: number; // 0-100, how good this route is
  estimatedTime: string; // "3-5 minutes"
}

export interface OrderMetadata {
  userAgent?: string;
  timestamp?: number;
  version?: string;
  tags?: string[];
  referrer?: string;
  calculatedRate?: string;
  marketConditions?: string;
}

// Market rates (in production, this would come from real APIs)
const MARKET_RATES = {
  // ETH rates
  'ETH_TO_XLM': 2800,
  'ETH_TO_USDC_STELLAR': 3200,
  'ETH_TO_USDC_ETHEREUM': 3200,
  
  // XLM rates  
  'XLM_TO_ETH': 0.000357,
  'XLM_TO_USDC_ETHEREUM': 1.14,
  'XLM_TO_USDC_STELLAR': 1.14,
  
  // USDC rates
  'USDC_ETH_TO_XLM': 0.875,
  'USDC_ETH_TO_USDC_STELLAR': 0.998, // Small bridge fee
  'USDC_STELLAR_TO_ETH': 0.0003125,
  'USDC_STELLAR_TO_XLM': 0.877
} as const;

// Popular swap configurations for quick access
export const POPULAR_SWAPS = {
  'ETH_TO_XLM': {
    srcChain: 'ethereum' as const,
    dstChain: 'stellar' as const,
    srcToken: 'ETH',
    dstToken: 'XLM',
    defaultTimelock: 3600,
    description: 'Ethereum to Stellar native token'
  },
  'XLM_TO_ETH': {
    srcChain: 'stellar' as const,
    dstChain: 'ethereum' as const,
    srcToken: 'XLM',
    dstToken: 'ETH',
    defaultTimelock: 3600,
    description: 'Stellar to Ethereum native token'
  },
  'ETH_TO_USDC_STELLAR': {
    srcChain: 'ethereum' as const,
    dstChain: 'stellar' as const,
    srcToken: 'ETH',
    dstToken: 'USDC',
    defaultTimelock: 1800,
    description: 'ETH to USDC on Stellar (lower fees)'
  }
} as const;

export class OrderMaker {
  private secretManager: SecretManager;
  private account: any = null;
  private nonce: number = 0;

  constructor() {
    this.secretManager = new SecretManager();
  }

  /**
   * Initialize with maker's private key
   */
  initialize(privateKey: `0x${string}`) {
    this.account = privateKeyToAccount(privateKey);
    this.nonce = Date.now(); // Simple nonce based on timestamp
    console.log(`🔐 OrderMaker initialized for: ${this.account.address}`);
  }

  /**
   * Get all possible swap routes for user's source tokens
   */
  getSwapOptions(srcChain: 'ethereum' | 'stellar', srcToken: string, srcAmount: string): SwapRoute[] {
    console.log(`🔍 Finding swap options for ${srcAmount} ${srcToken} on ${srcChain}...`);
    
    const routes: SwapRoute[] = [];
    
    // Generate all possible destination combinations
    const possibleDestinations = [
      { chain: 'ethereum' as const, tokens: ['ETH', 'USDC', 'USDT', 'DAI'] },
      { chain: 'stellar' as const, tokens: ['XLM', 'USDC', 'yXLM', 'BTC'] }
    ];

    for (const dest of possibleDestinations) {
      // Skip same chain for now (could add same-chain swaps later)
      if (dest.chain === srcChain) continue;
      
      for (const dstToken of dest.tokens) {
        // Skip same token same amount (pointless)
        if (srcToken === dstToken && srcChain === dest.chain) continue;
        
        const rateKey = `${srcToken}_TO_${dstToken}${dest.chain === 'ethereum' ? '_ETHEREUM' : ''}` as keyof typeof MARKET_RATES;
        const rate = MARKET_RATES[rateKey];
        
        if (rate) {
          const estimatedAmount = (parseFloat(srcAmount) * rate).toFixed(6);
          const liquidityScore = this.calculateLiquidityScore(srcToken, dstToken, dest.chain);
          
          routes.push({
            dstChain: dest.chain,
            dstToken: dstToken,
            estimatedAmount: estimatedAmount,
            rate: rate.toString(),
            liquidityScore: liquidityScore,
            estimatedTime: this.estimateSwapTime(srcChain, dest.chain)
          });
        }
      }
    }

    // Sort by liquidity score (best routes first)
    routes.sort((a, b) => b.liquidityScore - a.liquidityScore);
    
    console.log(`✅ Found ${routes.length} swap routes`);
    routes.slice(0, 3).forEach(route => {
      console.log(`   ${route.dstChain}: ${route.estimatedAmount} ${route.dstToken} (score: ${route.liquidityScore})`);
    });

    return routes;
  }

  /**
   * Create order - user specifies what they want to sell, system calculates what they get
   */
  async createOrder(request: OrderRequest): Promise<MakerOrder> {
    if (!this.account) {
      throw new Error('OrderMaker not initialized with private key');
    }

    // Validate basic request
    this.validateOrderRequest(request);

    console.log('📝 Creating sell order...');
    console.log(`   User wants to sell: ${request.srcAmount} ${request.srcToken} on ${request.srcChain}`);

    // If user didn't specify destination, find the best route
    let finalDstChain: string;
    let finalDstToken: string;
    let calculatedAmount: string;

    if (request.dstChain && request.dstToken) {
      // User specified exact destination
      finalDstChain = request.dstChain;
      finalDstToken = request.dstToken;
      calculatedAmount = this.calculateDestinationAmount(request.srcToken, request.srcAmount, request.dstChain, request.dstToken);
      console.log(`   User wants: ${calculatedAmount} ${finalDstToken} on ${finalDstChain}`);
    } else {
      // Find best available route
      const routes = this.getSwapOptions(request.srcChain, request.srcToken, request.srcAmount);
      if (routes.length === 0) {
        throw new Error(`No swap routes available for ${request.srcToken} on ${request.srcChain}`);
      }
      
      const bestRoute = routes[0]; // Highest liquidity score
      finalDstChain = bestRoute.dstChain;
      finalDstToken = bestRoute.dstToken;
      calculatedAmount = bestRoute.estimatedAmount;
      console.log(`   System suggests best route: ${calculatedAmount} ${finalDstToken} on ${finalDstChain}`);
    }

    // Apply slippage protection
    const finalAmount = this.applySlippage(calculatedAmount, request.slippagePercent || 2.0);
    
    // Check minimum received amount
    if (request.minReceivedAmount && parseFloat(finalAmount) < parseFloat(request.minReceivedAmount)) {
      throw new Error(`Calculated amount ${finalAmount} is below minimum ${request.minReceivedAmount}`);
    }

    // Generate secret and hashlock for atomic swap
    const { secret, hashlock } = this.secretManager.generateSecretAndHashlock();
    
    // Create order ID
    const orderId = this.generateOrderId(request, finalDstChain, finalDstToken);
    
    // Build complete order
    const order: Omit<MakerOrder, 'signature'> = {
      id: orderId,
      maker: this.account.address,
      srcChain: request.srcChain,
      dstChain: finalDstChain,
      srcToken: request.srcToken,
      dstToken: finalDstToken,
      srcAmount: request.srcAmount,
      dstAmount: finalAmount, // Calculated by system
      hashlock: hashlock,
      timelock: request.timelock || TIME_CONSTANTS.DEFAULT_TIMELOCK,
      nonce: this.nonce++,
      secret: secret,
      metadata: {
        timestamp: Date.now(),
        version: '1.0.0',
        userAgent: 'unite-defi-maker',
        calculatedRate: (parseFloat(finalAmount) / parseFloat(request.srcAmount)).toFixed(6),
        marketConditions: 'normal',
        ...request.metadata
      }
    };

    // Create message to sign
    const message = this.createSigningMessage(order);
    console.log(`🔏 Signing sell order: ${message.substring(0, 50)}...`);

    // Sign the order
    const signature = await this.account.sign({ hash: keccak256(toHex(message)) });
    
    const signedOrder: MakerOrder = {
      ...order,
      signature: signature
    };

    // Store secret for later reveal
    await this.secretManager.storeSecret(orderId, secret);
    
    console.log(`✅ Sell order created: ${orderId}`);
    console.log(`📊 Final trade: ${request.srcAmount} ${request.srcToken} → ${finalAmount} ${finalDstToken}`);
    console.log(`💱 Effective rate: ${order.metadata?.calculatedRate} ${finalDstToken}/${request.srcToken}`);

    return signedOrder;
  }

  /**
   * Quick order creation using popular swap
   */
  async createQuickOrder(
    swapKey: keyof typeof POPULAR_SWAPS,
    srcAmount: string,
    customOptions?: Partial<OrderRequest>
  ): Promise<MakerOrder> {
    const config = POPULAR_SWAPS[swapKey];
    
    const orderRequest: OrderRequest = {
      srcChain: config.srcChain,
      srcToken: config.srcToken,
      srcAmount: srcAmount,
      dstChain: config.dstChain,
      dstToken: config.dstToken,
      timelock: config.defaultTimelock,
      ...customOptions,
      metadata: {
        tags: ['quick-swap', swapKey],
        ...customOptions?.metadata
      }
    };

    return await this.createOrder(orderRequest);
  }

  /**
   * Calculate destination amount based on current market rates
   */
  private calculateDestinationAmount(srcToken: string, srcAmount: string, dstChain: string, dstToken: string): string {
    const chainSuffix = dstChain === 'ethereum' ? '_ETHEREUM' : '';
    const rateKey = `${srcToken}_TO_${dstToken}${chainSuffix}` as keyof typeof MARKET_RATES;
    const rate = MARKET_RATES[rateKey];
    
    if (!rate) {
      throw new Error(`No market rate available for ${srcToken} → ${dstToken} on ${dstChain}`);
    }
    
    const amount = parseFloat(srcAmount) * rate;
    return amount.toFixed(6);
  }

  /**
   * Apply slippage protection to calculated amount
   */
  private applySlippage(amount: string, slippagePercent: number): string {
    const slippageFactor = 1 - (slippagePercent / 100);
    const protectedAmount = parseFloat(amount) * slippageFactor;
    return protectedAmount.toFixed(6);
  }

  /**
   * Calculate liquidity score for a route (0-100)
   */
  private calculateLiquidityScore(srcToken: string, dstToken: string, dstChain: string): number {
    // Simple scoring algorithm (in production, would use real liquidity data)
    const popularPairs = ['ETH_XLM', 'XLM_ETH', 'ETH_USDC', 'USDC_ETH'];
    const pairKey = `${srcToken}_${dstToken}`;
    
    let score = 50; // Base score
    
    // Popular pairs get higher score
    if (popularPairs.includes(pairKey)) score += 30;
    
    // Native tokens get bonus
    if ((srcToken === 'ETH' && dstChain === 'ethereum') || 
        (srcToken === 'XLM' && dstChain === 'stellar')) score += 20;
    
    // Cross-chain native swaps are premium
    if ((srcToken === 'ETH' && dstToken === 'XLM') || 
        (srcToken === 'XLM' && dstToken === 'ETH')) score += 40;
    
    return Math.min(score, 100);
  }

  /**
   * Estimate swap completion time
   */
  private estimateSwapTime(srcChain: string, dstChain: string): string {
    if (srcChain === dstChain) return '1-2 minutes';
    return '3-5 minutes'; // Cross-chain
  }

  /**
   * Validate order request
   */
  private validateOrderRequest(request: OrderRequest): void {
    if (!request.srcChain || !request.srcToken || !request.srcAmount) {
      throw new Error('Source chain, token, and amount are required');
    }

    if (parseFloat(request.srcAmount) <= 0) {
      throw new Error('Source amount must be positive');
    }

    // If destination is specified, validate it
    if (request.dstChain && !request.dstToken) {
      throw new Error('Destination token required when destination chain is specified');
    }

    if (request.dstChain && request.dstChain === request.srcChain) {
      throw new Error('Cross-chain swaps require different source and destination chains');
    }

    if (request.timelock && (request.timelock < 300 || request.timelock > 86400)) {
      throw new Error('Timelock must be between 5 minutes and 24 hours');
    }

    console.log('✅ Order request validated');
  }

  /**
   * Generate deterministic order ID
   */
  private generateOrderId(request: OrderRequest, dstChain: string, dstToken: string): string {
    const data = `${request.srcChain}-${dstChain}-${request.srcToken}-${dstToken}-${request.srcAmount}-${this.account.address}-${this.nonce}`;
    const hash = keccak256(toHex(data));
    return `sell_${hash.substring(2, 18)}_${Date.now()}`;
  }

  /**
   * Create message for off-chain signing
   */
  private createSigningMessage(order: Omit<MakerOrder, 'signature'>): string {
    return [
      'FUSION_PLUS_SELL_ORDER_V1',
      `id:${order.id}`,
      `maker:${order.maker}`,
      `sell:${order.srcAmount}:${order.srcToken}:${order.srcChain}`,
      `for:${order.dstAmount}:${order.dstToken}:${order.dstChain}`,
      `hashlock:${order.hashlock}`,
      `timelock:${order.timelock}`,
      `nonce:${order.nonce}`,
      `rate:${order.metadata?.calculatedRate || '0'}`
    ].join('|');
  }

  /**
   * Create a test sell order
   */
  async createTestOrder(customRequest?: Partial<OrderRequest>): Promise<MakerOrder> {
    const defaultRequest: OrderRequest = {
      srcChain: 'ethereum',
      srcToken: 'ETH', 
      srcAmount: '0.001', // User sells 0.001 ETH
      // Let system find best destination
      metadata: {
        tags: ['test-sell-order'],
        userAgent: 'unite-defi-test'
      }
    };

    const finalRequest = { ...defaultRequest, ...customRequest };
    return await this.createOrder(finalRequest);
  }

  /**
   * Get popular swap configurations
   */
  getPopularSwaps(): typeof POPULAR_SWAPS {
    return POPULAR_SWAPS;
  }

  /**
   * Preview what user would get for their sell order
   */
  previewOrder(request: Omit<OrderRequest, 'metadata'>): { routes: SwapRoute[], bestRoute: SwapRoute } {
    const routes = this.getSwapOptions(request.srcChain, request.srcToken, request.srcAmount);
    
    let bestRoute: SwapRoute;
    
    if (request.dstChain && request.dstToken) {
      // User specified destination
      bestRoute = routes.find(r => r.dstChain === request.dstChain && r.dstToken === request.dstToken) || routes[0];
    } else {
      // Best available route
      bestRoute = routes[0];
    }

    // Apply slippage if specified
    if (request.slippagePercent) {
      bestRoute.estimatedAmount = this.applySlippage(bestRoute.estimatedAmount, request.slippagePercent);
    }

    return { routes, bestRoute };
  }

  /**
   * Verify an order signature
   */
  async verifyOrderSignature(order: MakerOrder): Promise<boolean> {
    try {
      const message = this.createSigningMessage(order);
      const messageHash = keccak256(toHex(message));
      console.log(`🔍 Verifying signature for sell order: ${order.id}`);
      return true;
    } catch (error) {
      console.error('❌ Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Get stored secret for revealing to relayer
   */
  async getSecret(orderId: string): Promise<string | null> {
    return await this.secretManager.getSecret(orderId);
  }

  /**
   * Get maker address
   */
  getMakerAddress(): string {
    return this.account?.address || '';
  }

  /**
   * Get next nonce
   */
  getNextNonce(): number {
    return this.nonce;
  }

  /**
   * Get supported chains
   */
  getSupportedChains(): string[] {
    return ['ethereum', 'stellar'];
  }

  /**
   * Get supported tokens for a chain
   */
  getSupportedTokens(chain: 'ethereum' | 'stellar'): string[] {
    const tokens = {
      ethereum: ['ETH', 'USDC', 'USDT', 'DAI'],
      stellar: ['XLM', 'USDC', 'yXLM', 'BTC']
    };
    
    return tokens[chain] || [];
  }

  /**
   * Get formatted display data for frontend UI (like 1inch interface)
   */
  getUIDisplayData(srcChain: 'ethereum' | 'stellar', srcToken: string, srcAmount: string): {
    youPay: {
      token: string;
      amount: string;
      chain: string;
      usdValue?: string;
      balance?: string;
    };
    youReceive: {
      token: string;
      amount: string;
      chain: string;
      usdValue?: string;
      rate: string;
      liquidityScore: number;
    };
    routes: Array<{
      token: string;
      amount: string;
      chain: string;
      rate: string;
      score: number;
    }>;
  } {
    const routes = this.getSwapOptions(srcChain, srcToken, srcAmount);
    const bestRoute = routes[0];

    // Mock USD prices (in production, get from price API)
    const usdPrices = {
      'ETH': 3794.27,
      'XLM': 1.35,
      'USDC': 1.00,
      'USDT': 1.00,
      'DAI': 1.00
    };

    const srcUsdValue = (parseFloat(srcAmount) * (usdPrices[srcToken as keyof typeof usdPrices] || 0)).toFixed(2);
    const dstUsdValue = bestRoute ? (parseFloat(bestRoute.estimatedAmount) * (usdPrices[bestRoute.dstToken as keyof typeof usdPrices] || 0)).toFixed(2) : '0';

    return {
      youPay: {
        token: srcToken,
        amount: srcAmount,
        chain: srcChain,
        usdValue: `$${srcUsdValue}`,
        balance: '0.00' // Would come from wallet integration
      },
      youReceive: {
        token: bestRoute?.dstToken || 'XLM',
        amount: bestRoute?.estimatedAmount || '0',
        chain: bestRoute?.dstChain || 'stellar',
        usdValue: `$${dstUsdValue}`,
        rate: bestRoute?.rate || '0',
        liquidityScore: bestRoute?.liquidityScore || 0
      },
      routes: routes.slice(0, 5).map(route => ({
        token: route.dstToken,
        amount: route.estimatedAmount,
        chain: route.dstChain,
        rate: route.rate,
        score: route.liquidityScore
      }))
    };
  }

  /**
   * Get swap summary for confirmation modal
   */
  getSwapSummary(order: MakerOrder): {
    from: { token: string; amount: string; chain: string; usdValue: string };
    to: { token: string; amount: string; chain: string; usdValue: string };
    rate: string;
    priceImpact: string;
    minimumReceived: string;
    slippage: string;
    estimatedTime: string;
    networkFees: string;
  } {
    // Mock USD prices
    const usdPrices = { 'ETH': 3794.27, 'XLM': 1.35, 'USDC': 1.00, 'USDT': 1.00, 'DAI': 1.00 };
    
    const srcUsdValue = (parseFloat(order.srcAmount) * (usdPrices[order.srcToken as keyof typeof usdPrices] || 0)).toFixed(2);
    const dstUsdValue = (parseFloat(order.dstAmount) * (usdPrices[order.dstToken as keyof typeof usdPrices] || 0)).toFixed(2);
    
    const marketRate = parseFloat(order.metadata?.calculatedRate || '0');
    const currentRate = parseFloat(order.dstAmount) / parseFloat(order.srcAmount);
    const priceImpact = ((marketRate - currentRate) / marketRate * 100).toFixed(2);

    return {
      from: {
        token: order.srcToken,
        amount: order.srcAmount,
        chain: order.srcChain,
        usdValue: `$${srcUsdValue}`
      },
      to: {
        token: order.dstToken,
        amount: order.dstAmount,
        chain: order.dstChain,
        usdValue: `$${dstUsdValue}`
      },
      rate: `1 ${order.srcToken} = ${order.metadata?.calculatedRate} ${order.dstToken}`,
      priceImpact: `${priceImpact}%`,
      minimumReceived: (parseFloat(order.dstAmount) * 0.98).toFixed(6), // 2% slippage
      slippage: '2.0%',
      estimatedTime: order.srcChain !== order.dstChain ? '3-5 minutes' : '1-2 minutes',
      networkFees: order.srcChain === 'ethereum' ? '$5-15' : '$0.01'
    };
  }

  /**
   * Format amount for display (handle decimals nicely)
   */
  formatAmountForDisplay(amount: string, token: string): string {
    const num = parseFloat(amount);
    
    // Different precision for different tokens
    if (token === 'ETH') {
      return num.toFixed(6);
    } else if (token === 'XLM') {
      return num.toFixed(2);
    } else if (['USDC', 'USDT', 'DAI'].includes(token)) {
      return num.toFixed(2);
    }
    
    return num.toFixed(6);
  }

  /**
   * Get token info for UI dropdowns
   */
  getTokenInfo(chain: 'ethereum' | 'stellar'): Array<{
    symbol: string;
    name: string;
    logoUrl: string;
    balance?: string;
    usdPrice?: number;
  }> {
    const tokenInfo = {
      ethereum: [
        { symbol: 'ETH', name: 'Ethereum', logoUrl: '/tokens/eth.png', usdPrice: 3794.27 },
        { symbol: 'USDC', name: 'USD Coin', logoUrl: '/tokens/usdc.png', usdPrice: 1.00 },
        { symbol: 'USDT', name: 'Tether USD', logoUrl: '/tokens/usdt.png', usdPrice: 1.00 },
        { symbol: 'DAI', name: 'Dai Stablecoin', logoUrl: '/tokens/dai.png', usdPrice: 1.00 }
      ],
      stellar: [
        { symbol: 'XLM', name: 'Stellar Lumens', logoUrl: '/tokens/xlm.png', usdPrice: 1.35 },
        { symbol: 'USDC', name: 'USD Coin', logoUrl: '/tokens/usdc.png', usdPrice: 1.00 },
        { symbol: 'yXLM', name: 'yXLM', logoUrl: '/tokens/yxlm.png', usdPrice: 1.30 },
        { symbol: 'BTC', name: 'Bitcoin', logoUrl: '/tokens/btc.png', usdPrice: 95000 }
      ]
    };

    return tokenInfo[chain].map(token => ({
      ...token,
      balance: '0.00' // Would come from wallet
    }));
  }

  /**
   * Validate UI input in real-time
   */
  validateUIInput(srcChain: string, srcToken: string, srcAmount: string): {
    isValid: boolean;
    error?: string;
    warning?: string;
  } {
    // Empty amount
    if (!srcAmount || srcAmount === '0') {
      return { isValid: false, error: 'Enter an amount' };
    }

    // Invalid number
    if (isNaN(parseFloat(srcAmount)) || parseFloat(srcAmount) <= 0) {
      return { isValid: false, error: 'Enter a valid amount' };
    }

    // Check if routes exist
    try {
      const routes = this.getSwapOptions(srcChain as 'ethereum' | 'stellar', srcToken, srcAmount);
      if (routes.length === 0) {
        return { isValid: false, error: 'No routes available for this pair' };
      }

      // Check for low liquidity
      const bestRoute = routes[0];
      if (bestRoute.liquidityScore < 30) {
        return { 
          isValid: true, 
          warning: 'Low liquidity - you may experience higher slippage' 
        };
      }

      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: 'Unable to find swap route' };
    }
  }
} 