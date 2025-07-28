import { FusionOrder } from '../../../shared/types';
import { CrossChainMonitor } from '../../../cross-chain-utils/monitorCC';
import { StellarResolver } from '../../resolver/resolverIntegration';
import { SecretManager } from '../../../cross-chain-utils/secretManager';
import { MakerOrder } from '../../orders/OrderMaker';
import { TIME_CONSTANTS } from '../../../shared/constants';

export interface DutchAuction {
  orderId: string;
  orderHash: string;
  maker: string;
  srcChain: string;
  dstChain: string;
  srcToken: string;
  dstToken: string;
  srcAmount: string;
  dstAmount: string;
  hashlock: string;
  timelock: number;
  startTime: number;
  endTime: number;
  startRate: string;
  currentRate: string;
  minRate: string;
  decreaseRate: number;
  status: 'active' | 'taken' | 'expired' | 'completed';
  takenBy?: string; // Resolver address
  escrowsReady: {
    ethereum: boolean;
    stellar: boolean;
  };
}

export class FusionPlusRelayer {
  private crossChainMonitor: CrossChainMonitor;
  private stellarResolver: StellarResolver;
  private secretManager: SecretManager;
  private apiKey: string;
  
  // Active auctions management
  private activeAuctions: Map<string, DutchAuction> = new Map();
  private pendingOrders: Map<string, MakerOrder> = new Map();
  private isRunning: boolean = false;
  private auctionUpdateInterval: NodeJS.Timeout | null = null;
  private timeoutCheckInterval: NodeJS.Timeout | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.crossChainMonitor = new CrossChainMonitor(apiKey);
    this.stellarResolver = new StellarResolver(apiKey);
    this.secretManager = new SecretManager();
  }

    async start() {
    console.log('🚀 Starting FusionPlus Relayer...');
    
        await this.crossChainMonitor.startMonitoring();
        await this.stellarResolver.startMonitoring();
        
    this.isRunning = true;
    this.startAuctionUpdates();
    this.setupEventHandlers();
    
    console.log('✅ FusionPlus Relayer started successfully');
  }

  /**
   * Receive signed order from maker and create Dutch auction
   */
  async receiveOrderFromMaker(signedOrder: MakerOrder): Promise<string> {
    console.log(`📨 Received order from maker: ${signedOrder.maker}`);
    console.log(`   Order: ${signedOrder.srcAmount} ${signedOrder.srcToken} → ${signedOrder.dstAmount} ${signedOrder.dstToken}`);
    
    // Verify order signature (basic validation)
    if (!this.validateOrder(signedOrder)) {
      throw new Error('Invalid order signature or format');
    }

    // Store pending order
    this.pendingOrders.set(signedOrder.id, signedOrder);
    
    // Create Dutch auction
    const auctionId = await this.createDutchAuction(signedOrder);
    
    console.log(`📢 Dutch auction created: ${auctionId}`);
    console.log(`⏰ Auction will run for ${TIME_CONSTANTS.AUCTION_DURATION / 60} minutes`);
    
    return auctionId;
  }

  /**
   * Create Dutch auction from signed order
   */
  private async createDutchAuction(order: MakerOrder): Promise<string> {
    const now = Date.now();
    const auctionId = `auction_${order.id}_${now}`;
    
    // Calculate auction rates (simplified Dutch auction)
    const startRate = this.calculateStartRate(order);
    const minRate = this.calculateMinRate(order);
    const decreaseRate = this.calculateDecreaseRate(startRate, minRate);
    
    const auction: DutchAuction = {
      orderId: order.id,
      orderHash: order.id, // Using order ID as hash for now
      maker: order.maker,
      srcChain: order.srcChain,
      dstChain: order.dstChain,
      srcToken: order.srcToken,
      dstToken: order.dstToken,
      srcAmount: order.srcAmount,
      dstAmount: order.dstAmount,
      hashlock: order.hashlock,
      timelock: order.timelock,
      startTime: now,
      endTime: now + (TIME_CONSTANTS.AUCTION_DURATION * 1000),
      startRate: startRate,
      currentRate: startRate,
      minRate: minRate,
      decreaseRate: decreaseRate,
      status: 'active',
      escrowsReady: {
        ethereum: false,
        stellar: false
      }
    };

    // Store active auction
    this.activeAuctions.set(auctionId, auction);
    
    // Notify resolvers about new auction
    await this.notifyResolvers(auction);
    
    return auctionId;
  }

  /**
   * Get active auctions (for resolvers to query)
   */
  getActiveAuctions(): DutchAuction[] {
    return Array.from(this.activeAuctions.values())
      .filter(auction => auction.status === 'active');
  }

  /**
   * Resolver takes an auction
   */
  async resolverTakesAuction(auctionId: string, resolverAddress: string): Promise<boolean> {
    const auction = this.activeAuctions.get(auctionId);
    
    if (!auction || auction.status !== 'active') {
      console.log(`❌ Auction ${auctionId} not available`);
      return false;
    }
    
    // Check if auction has expired
    if (Date.now() > auction.endTime) {
      auction.status = 'expired';
      console.log(`⏰ Auction ${auctionId} expired`);
      return false;
    }
    
    // Update auction status
    auction.status = 'taken';
    auction.takenBy = resolverAddress;
    auction.currentRate = this.getCurrentRate(auction);
    
    console.log(`🎯 Resolver ${resolverAddress} took auction ${auctionId}`);
    console.log(`💰 Final rate: ${auction.currentRate}`);
    
    // Start monitoring for escrow creation
    this.startEscrowMonitoring(auction);
    
    return true;
  }

  /**
   * Notify when escrow is created on a chain
   */
  async notifyEscrowCreated(auctionId: string, chain: 'ethereum' | 'stellar', txHash: string) {
    const auction = this.activeAuctions.get(auctionId);
    if (!auction) return;
    
    auction.escrowsReady[chain] = true;
    console.log(`✅ Escrow created on ${chain} for auction ${auctionId}: ${txHash}`);
    
    // Check if both escrows are ready
    if (auction.escrowsReady.ethereum && auction.escrowsReady.stellar) {
      console.log(`🎉 Both escrows ready for auction ${auctionId}`);
      await this.handleEscrowsReady(auction);
    }
  }

  /**
   * Handle when both escrows are ready - wait for maker to reveal secret
   */
  private async handleEscrowsReady(auction: DutchAuction) {
    console.log(`🔐 Waiting for maker to reveal secret for order: ${auction.orderId}`);
    
    // In practice, maker would call revealSecret() method
    // For now, we'll simulate this after a short delay
    setTimeout(async () => {
      await this.simulateSecretReveal(auction);
    }, 5000);
  }

  /**
   * Maker reveals secret to relayer
   */
  async revealSecret(orderId: string, secret: string): Promise<boolean> {
    const auction = Array.from(this.activeAuctions.values())
      .find(a => a.orderId === orderId);
    
    if (!auction) {
      console.log(`❌ No auction found for order: ${orderId}`);
      return false;
    }
    
    // Verify secret matches hashlock
    if (!this.secretManager.verifySecret(secret, auction.hashlock)) {
      console.log(`❌ Invalid secret for order: ${orderId}`);
      return false;
    }
    
    console.log(`🔐 Secret revealed for order: ${orderId}`);
    
    // Notify resolver to complete the swap
    await this.notifyResolverToComplete(auction, secret);
    
    auction.status = 'completed';
    return true;
  }

  /**
   * Start updating auction rates (Dutch auction mechanism)
   */
  private startAuctionUpdates() {
    // Store interval ID so we can clear it later
    if (this.auctionUpdateInterval) {
      clearInterval(this.auctionUpdateInterval);
    }
    
    this.auctionUpdateInterval = setInterval(() => {
      this.updateAuctionRates();
    }, 10000); // Update every 10 seconds
  }

  /**
   * Update current rates for all active auctions
   */
  private updateAuctionRates() {
    const now = Date.now();
    
    for (const [auctionId, auction] of this.activeAuctions) {
      if (auction.status !== 'active') continue;
      
      // Check if expired
      if (now > auction.endTime) {
        auction.status = 'expired';
        console.log(`⏰ Auction expired: ${auctionId}`);
        continue;
      }
      
      // Update current rate (Dutch auction decrease)
      const timeElapsed = now - auction.startTime;
      const totalTime = auction.endTime - auction.startTime;
      const progress = timeElapsed / totalTime;
      
      const startRateNum = parseFloat(auction.startRate);
      const minRateNum = parseFloat(auction.minRate);
      const currentRateNum = startRateNum - (startRateNum - minRateNum) * progress;
      
      auction.currentRate = Math.max(currentRateNum, minRateNum).toFixed(6);
    }
  }

  /**
   * Calculate starting rate for Dutch auction (simplified)
   */
  private calculateStartRate(order: MakerOrder): string {
    // Start 20% above market rate to give resolver profit margin
    const marketRate = parseFloat(order.dstAmount) / parseFloat(order.srcAmount);
    return (marketRate * 1.2).toFixed(6);
  }

  /**
   * Calculate minimum rate (simplified)
   */
  private calculateMinRate(order: MakerOrder): string {
    // Minimum is the exact requested rate
    const exactRate = parseFloat(order.dstAmount) / parseFloat(order.srcAmount);
    return exactRate.toFixed(6);
  }

  /**
   * Calculate decrease rate for Dutch auction
   */
  private calculateDecreaseRate(startRate: string, minRate: string): number {
    const start = parseFloat(startRate);
    const min = parseFloat(minRate);
    return (start - min) / (TIME_CONSTANTS.AUCTION_DURATION / 1000); // Per second
  }

  /**
   * Get current rate for an auction
   */
  private getCurrentRate(auction: DutchAuction): string {
    const now = Date.now();
    const timeElapsed = now - auction.startTime;
    const totalTime = auction.endTime - auction.startTime;
    const progress = Math.min(timeElapsed / totalTime, 1);
    
    const startRateNum = parseFloat(auction.startRate);
    const minRateNum = parseFloat(auction.minRate);
    const currentRateNum = startRateNum - (startRateNum - minRateNum) * progress;
    
    return Math.max(currentRateNum, minRateNum).toFixed(6);
  }

  /**
   * Validate order format and signature
   */
  private validateOrder(order: MakerOrder): boolean {
    // Basic validation
    if (!order.id || !order.maker || !order.signature) {
      return false;
    }
    
    if (!order.srcChain || !order.dstChain || !order.hashlock) {
      return false;
    }
    
    // TODO: Implement proper signature verification
    return true;
  }

  /**
   * Notify resolvers about new auction
   */
  private async notifyResolvers(auction: DutchAuction) {
    console.log(`📢 Notifying resolvers about auction: ${auction.orderId}`);
    // In practice, this would send notifications to registered resolvers
    // For now, we'll just log the auction info
  }

  /**
   * Start monitoring escrow creation for an auction
   */
  private startEscrowMonitoring(auction: DutchAuction) {
    console.log(`👀 Starting escrow monitoring for auction: ${auction.orderId}`);
    // This would integrate with CrossChainMonitor
  }

  /**
   * Simulate secret reveal for testing
   */
  private async simulateSecretReveal(auction: DutchAuction) {
    console.log(`🧪 Simulating secret reveal for auction: ${auction.orderId}`);
    
    // Get secret from pending order
    const order = this.pendingOrders.get(auction.orderId);
    if (order && order.secret) {
      await this.revealSecret(auction.orderId, order.secret);
    }
  }

  /**
   * Notify resolver to complete swap with secret
   */
  private async notifyResolverToComplete(auction: DutchAuction, secret: string) {
    console.log(`🔔 Notifying resolver to complete swap: ${auction.orderId}`);
    console.log(`🔐 Secret: ${secret.substring(0, 10)}...`);
    // This would send the secret to the resolver who took the auction
  }

  private setupEventHandlers() {
    // Setup event handlers for monitoring
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
    }
    
    this.timeoutCheckInterval = setInterval(() => {
      this.checkForTimeouts();
    }, TIME_CONSTANTS.MONITORING_INTERVAL);
  }

  private checkForTimeouts() {
    // Check for expired auctions, stuck orders, etc.
  }

  async stop() {
    console.log('⏹️  Stopping FusionPlus Relayer...');
    this.isRunning = false;
    
    // Clear all intervals
    if (this.auctionUpdateInterval) {
      clearInterval(this.auctionUpdateInterval);
      this.auctionUpdateInterval = null;
    }
    
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = null;
    }
    
    await this.stellarResolver.stopMonitoring();
    console.log('✅ FusionPlus Relayer stopped');
  }

  getStatus() {
    return {
      active: this.isRunning,
      activeAuctions: this.activeAuctions.size,
      pendingOrders: this.pendingOrders.size,
      timestamp: Date.now(),
      resolverStatus: this.stellarResolver.getStatus(),
    };
    }
}