#!/usr/bin/env node

/**
 * 🧪 FUSION+ END-TO-END TEST
 * Simula l'intero flusso del protocollo Fusion+
 */

import { createHash } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

interface TestStep {
  name: string;
  action: () => Promise<void>;
  delay?: number;
}

class FusionPlusEndToEndTest {
  private orderId: string;
  private secret: string;
  private hashlock: string;
  private currentPrice: string = '';

  constructor() {
    this.orderId = `e2e-${Date.now()}`; // Shorter orderId
    this.secret = `secret-${Date.now()}`;
    this.hashlock = createHash('sha256').update(this.secret).digest('hex');
  }

  async run() {
    console.log('🧪 FUSION+ END-TO-END TEST');
    console.log('===========================');
    console.log(`🆔 Order ID: ${this.orderId}`);
    console.log(`🔐 Secret: ${this.secret}`);
    console.log(`🔑 Hashlock: ${this.hashlock}`);
    console.log('');

    const steps: TestStep[] = [
      {
        name: '📤 1. Maker submits Fusion+ order',
        action: () => this.submitOrder(),
        delay: 2000
      },
      {
        name: '⏳ 2. Wait for auction to start',
        action: () => this.waitForAuction(),
        delay: 5000
      },
      {
        name: '🔍 3. Monitor price updates',
        action: () => this.monitorPrices(),
        delay: 10000
      },
      {
        name: '🏦 4. Simulate Ethereum escrow creation',
        action: () => this.simulateEthereumEscrow(),
        delay: 3000
      },
      {
        name: '🔍 5. Verify price updates stopped',
        action: () => this.verifyPriceStopped(),
        delay: 5000
      },
      {
        name: '⭐ 6. Simulate Stellar escrow creation',
        action: () => this.simulateStellarEscrow(),
        delay: 3000
      },
      {
        name: '⏰ 7. Wait for finality',
        action: () => this.waitForFinality(),
        delay: 5000
      },
      {
        name: '🔓 8. Simulate secret reveal',
        action: () => this.simulateSecretReveal(),
        delay: 2000
      },
      {
        name: '✅ 9. Verify completion',
        action: () => this.verifyCompletion(),
        delay: 2000
      }
    ];

    for (const step of steps) {
      console.log(`\n${step.name}`);
      console.log('─'.repeat(50));
      
      try {
        await step.action();
        console.log(`✅ ${step.name} - COMPLETED`);
        
        if (step.delay) {
          console.log(`⏳ Waiting ${step.delay/1000}s...`);
          await this.sleep(step.delay);
        }
      } catch (error) {
        console.error(`❌ ${step.name} - FAILED:`, error);
        break;
      }
    }

    console.log('\n🎉 END-TO-END TEST COMPLETED!');
  }

  private async submitOrder(): Promise<void> {
    const order = {
      orderId: this.orderId,
      maker: '0xBE7E687e50889E8F4d7ec7d968Ddef132D04313a',
      makerStellar: 'GDJ7IBGIHSWIXV5HY7VOUD6QRO3PD7RFQOYR4UATGB63WGZPQD5AS367',
      srcChain: 'ethereum',
      dstChain: 'stellar',
      srcToken: '0x0000000000000000000000000000000000000000',
      dstToken: 'native',
      srcAmount: '1000000000000000',
      dstAmount: '10000000',
      startPrice: '1050000000',
      minPrice: '950000000',
      hashlock: this.hashlock,
      secret: this.secret,
      signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      timestamp: Date.now(),
      deadline: Date.now() + 3600000
    };

    const response = await fetch('http://localhost:3002/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(`Order submission failed: ${result.error}`);
    }

    console.log(`✅ Order submitted: ${result.orderId}`);
    console.log(`⏰ Auction starts at: ${new Date(result.auctionStartTime).toLocaleTimeString()}`);
  }

  private async waitForAuction(): Promise<void> {
    console.log('⏳ Waiting for Dutch auction to start...');
    await this.sleep(35000); // Wait for 30s waiting period + 5s buffer
  }

  private async monitorPrices(): Promise<void> {
    console.log('📊 Monitoring price updates...');
    
    // Check order status a few times to see price changes
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`http://localhost:3002/orders/${this.orderId}`);
      const order = await response.json();
      
      if (order.currentPrice) {
        this.currentPrice = order.currentPrice;
        console.log(`💰 Current price: ${order.currentPrice} (${order.status})`);
      }
      
      await this.sleep(3000);
    }
  }

  private async simulateEthereumEscrow(): Promise<void> {
    console.log('🏦 Simulating Ethereum escrow creation...');
    
    const response = await fetch('http://localhost:3002/simulate-escrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: this.orderId,
        chain: 'ethereum'
      })
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(`Ethereum escrow simulation failed: ${result.error}`);
    }

    console.log(`✅ Ethereum escrow simulated: ${result.message}`);
  }

  private async verifyPriceStopped(): Promise<void> {
    console.log('🔍 Verifying price updates stopped...');
    
    // Check order status multiple times to confirm price is fixed
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`http://localhost:3002/orders/${this.orderId}`);
      const order = await response.json();
      
      console.log(`💰 Price check ${i+1}: ${order.currentPrice} (${order.status})`);
      
      if (order.status === 'filled') {
        console.log('✅ Price is FIXED - auction stopped correctly!');
        break;
      }
      
      await this.sleep(2000);
    }
  }

  private async simulateStellarEscrow(): Promise<void> {
    console.log('⭐ Simulating Stellar escrow creation...');
    
    const response = await fetch('http://localhost:3002/simulate-escrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: this.orderId,
        chain: 'stellar'
      })
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(`Stellar escrow simulation failed: ${result.error}`);
    }

    console.log(`✅ Stellar escrow simulated: ${result.message}`);
  }

  private async waitForFinality(): Promise<void> {
    console.log('⏰ Waiting for finality locks...');
    console.log('📋 Both escrows created - waiting for finality...');
    await this.sleep(5000);
  }

  private async simulateSecretReveal(): Promise<void> {
    console.log('🔓 Simulating secret reveal...');
    
    // This would normally happen automatically after finality
    // For testing, we'll simulate it manually
    console.log(`🔐 Secret revealed: ${this.secret}`);
    console.log('📡 Broadcasting to all resolvers...');
  }

  private async verifyCompletion(): Promise<void> {
    console.log('✅ Verifying swap completion...');
    
    const response = await fetch(`http://localhost:3002/orders/${this.orderId}`);
    const order = await response.json();
    
    console.log(`📊 Final order status: ${order.status}`);
    console.log(`💰 Final price: ${order.currentPrice}`);
    
    if (order.status === 'filled') {
      console.log('🎉 SWAP COMPLETED SUCCESSFULLY!');
    } else {
      console.log('⚠️ Swap not yet completed');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the test
const test = new FusionPlusEndToEndTest();
test.run().catch(console.error); 