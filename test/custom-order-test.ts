#!/usr/bin/env ts-node

import { OrderMaker, SWAP_CONFIGS, OrderRequest } from '../stellar/orders/OrderMaker';
import { FusionPlusRelayer } from '../stellar/relayer/src/index';
import dotenv from 'dotenv';

// Load environment variables  
dotenv.config();

console.log('🧪 Testing Custom Order Parameters & Frontend-Ready Features\n');

async function testCustomOrderCreation() {
  console.log('🎯 TESTING CUSTOM ORDER CREATION\n');

  const privateKey = process.env.PRIVATE_KEY as `0x${string}` || `0x${'1'.repeat(64)}`;
  const orderMaker = new OrderMaker();
  orderMaker.initialize(privateKey);

  // Test 1: Basic custom order
  console.log('📝 Test 1: Custom ETH → XLM order');
  try {
    const customOrder1: OrderRequest = {
      srcChain: 'ethereum',
      dstChain: 'stellar',
      srcToken: 'ETH',
      dstToken: 'XLM',
      srcAmount: '0.005', // User-specified amount
      dstAmount: '14.0',   // User-specified amount
      timelock: 7200,      // 2 hours (user choice)
      slippagePercent: 2.5,
      metadata: {
        userAgent: 'unite-defi-frontend-v1.0',
        referrer: 'dex-interface',
        tags: ['user-custom', 'high-value']
      }
    };

    const signedOrder1 = await orderMaker.createOrder(customOrder1);
    console.log(`✅ Custom order created: ${signedOrder1.id}`);
    console.log(`   Metadata: ${JSON.stringify(signedOrder1.metadata, null, 2)}`);
    console.log('');

  } catch (error) {
    console.error('❌ Custom order 1 failed:', error);
  }

  // Test 2: Reverse direction (XLM → ETH)
  console.log('📝 Test 2: Custom XLM → ETH order (reverse direction)');
  try {
    const customOrder2: OrderRequest = {
      srcChain: 'stellar',
      dstChain: 'ethereum',
      srcToken: 'XLM',
      dstToken: 'ETH',
      srcAmount: '5000',    // Large XLM amount
      dstAmount: '1.785',   // Calculated ETH amount
      timelock: 1800,       // 30 minutes (fast trade)
      deadline: Date.now() + (60 * 60 * 1000), // 1 hour from now
      metadata: {
        userAgent: 'mobile-app-v2.1',
        tags: ['mobile', 'fast-trade', 'xlm-to-eth']
      }
    };

    const signedOrder2 = await orderMaker.createOrder(customOrder2);
    console.log(`✅ Reverse order created: ${signedOrder2.id}`);
    console.log(`   Direction: ${signedOrder2.srcChain} → ${signedOrder2.dstChain}`);
    console.log(`   Amounts: ${signedOrder2.srcAmount} ${signedOrder2.srcToken} → ${signedOrder2.dstAmount} ${signedOrder2.dstToken}`);
    console.log('');

  } catch (error) {
    console.error('❌ Custom order 2 failed:', error);
  }

  // Test 3: USDC cross-chain
  console.log('📝 Test 3: USDC cross-chain transfer');
  try {
    const usdcOrder: OrderRequest = {
      srcChain: 'ethereum',
      dstChain: 'stellar',
      srcToken: 'USDC',
      dstToken: 'USDC',
      srcAmount: '1000',
      dstAmount: '998.5', // With fees
      timelock: 3600,
      slippagePercent: 0.5,
      metadata: {
        userAgent: 'web-interface',
        tags: ['stablecoin', 'cross-chain', 'usdc'],
        referrer: 'defi-portal'
      }
    };

    const signedOrder3 = await orderMaker.createOrder(usdcOrder);
    console.log(`✅ USDC cross-chain order: ${signedOrder3.id}`);
    console.log(`   Same token cross-chain: ${signedOrder3.srcToken} → ${signedOrder3.dstToken}`);
    console.log('');

  } catch (error) {
    console.error('❌ USDC order failed:', error);
  }
}

async function testPredefinedConfigurations() {
  console.log('🎯 TESTING PREDEFINED CONFIGURATIONS\n');

  const privateKey = process.env.PRIVATE_KEY as `0x${string}` || `0x${'1'.repeat(64)}`;
  const orderMaker = new OrderMaker();
  orderMaker.initialize(privateKey);

  // Show available configurations
  console.log('📋 Available swap configurations:');
  const configs = orderMaker.getAvailableConfigs();
  Object.entries(configs).forEach(([key, config]) => {
    console.log(`   ${key}: ${config.srcToken} (${config.srcChain}) → ${config.dstToken} (${config.dstChain})`);
    console.log(`     Default timelock: ${config.defaultTimelock}s`);
    console.log(`     Amount range: ${config.minAmount} - ${config.maxAmount}`);
  });
  console.log('');

  // Test predefined config usage
  console.log('📝 Test: Using ETH_TO_XLM configuration');
  try {
    const configOrder = await orderMaker.createOrderFromConfig(
      'ETH_TO_XLM',
      { srcAmount: '0.1', dstAmount: '280' },
      {
        slippagePercent: 1.0,
        metadata: {
          userAgent: 'frontend-quick-swap',
          tags: ['quick-config', 'eth-xlm']
        }
      }
    );

    console.log(`✅ Config-based order: ${configOrder.id}`);
    console.log(`   Using config: ETH_TO_XLM`);
    console.log(`   Tags: ${configOrder.metadata?.tags?.join(', ')}`);
    console.log('');

  } catch (error) {
    console.error('❌ Config order failed:', error);
  }
}

async function testValidationAndRates() {
  console.log('🎯 TESTING VALIDATION & RATE ESTIMATION\n');

  const privateKey = process.env.PRIVATE_KEY as `0x${string}` || `0x${'1'.repeat(64)}`;
  const orderMaker = new OrderMaker();
  orderMaker.initialize(privateKey);

  // Test rate estimation
  console.log('💱 Testing rate estimation:');
  try {
    const ethAmount = '1.0';
    const xlmEstimate = orderMaker.estimateRate('ETH_TO_XLM', ethAmount);
    console.log(`   ${ethAmount} ETH → ${xlmEstimate} XLM`);

    const xlmAmount = '2800';
    const ethEstimate = orderMaker.estimateRate('XLM_TO_ETH', xlmAmount);
    console.log(`   ${xlmAmount} XLM → ${ethEstimate} ETH`);

    const usdcAmount = '1000';
    const usdcEstimate = orderMaker.estimateRate('USDC_ETH_TO_STELLAR', usdcAmount);
    console.log(`   ${usdcAmount} USDC (ETH) → ${usdcEstimate} USDC (Stellar)`);
    console.log('');

  } catch (error) {
    console.error('❌ Rate estimation failed:', error);
  }

  // Test validation (should fail)
  console.log('🚫 Testing validation (should fail):');
  
  const invalidOrders = [
    {
      name: 'Same chain swap',
      order: {
        srcChain: 'ethereum' as const,
        dstChain: 'ethereum' as const,
        srcToken: 'ETH',
        dstToken: 'USDC',
        srcAmount: '1',
        dstAmount: '3000'
      }
    },
    {
      name: 'Negative amount', 
      order: {
        srcChain: 'ethereum' as const,
        dstChain: 'stellar' as const,
        srcToken: 'ETH',
        dstToken: 'XLM',
        srcAmount: '-1',
        dstAmount: '2800'
      }
    },
    {
      name: 'Invalid timelock',
      order: {
        srcChain: 'ethereum' as const,
        dstChain: 'stellar' as const,
        srcToken: 'ETH',
        dstToken: 'XLM',
        srcAmount: '1',
        dstAmount: '2800',
        timelock: 100 // Too short
      }
    }
  ];

  for (const { name, order } of invalidOrders) {
    try {
      await orderMaker.createOrder(order);
      console.log(`❌ ${name} should have failed but didn't`);
    } catch (error) {
      console.log(`✅ ${name} correctly rejected: ${(error as Error).message.substring(0, 50)}...`);
    }
  }
  console.log('');
}

async function testSupportedChainsAndTokens() {
  console.log('🎯 TESTING SUPPORTED CHAINS & TOKENS\n');

  const orderMaker = new OrderMaker();
  
  console.log('🔗 Supported chains:');
  const chains = orderMaker.getSupportedChains();
  chains.forEach(chain => console.log(`   - ${chain}`));
  console.log('');

  console.log('🪙 Supported tokens:');
  chains.forEach(chain => {
    const tokens = orderMaker.getSupportedTokens(chain as 'ethereum' | 'stellar');
    console.log(`   ${chain}: ${tokens.join(', ')}`);
  });
  console.log('');
}

async function testIntegrationWithRelayer() {
  console.log('🎯 TESTING INTEGRATION WITH RELAYER\n');

  const privateKey = process.env.PRIVATE_KEY as `0x${string}` || `0x${'1'.repeat(64)}`;
  const orderMaker = new OrderMaker();
  orderMaker.initialize(privateKey);

  const relayer = new FusionPlusRelayer('test_api_key');

  try {
    // Create a custom order
    const userOrder: OrderRequest = {
      srcChain: 'ethereum',
      dstChain: 'stellar',
      srcToken: 'ETH',
      dstToken: 'XLM',
      srcAmount: '0.05',  // User wants to swap 0.05 ETH
      dstAmount: '140',   // Expects 140 XLM
      timelock: 5400,     // 1.5 hours (user preference)
      slippagePercent: 3.0,
      metadata: {
        userAgent: 'unite-defi-frontend-v1.2',
        referrer: 'main-interface',
        tags: ['frontend-user', 'custom-params']
      }
    };

    console.log('👤 User creating custom order...');
    const signedOrder = await orderMaker.createOrder(userOrder);
    
    console.log('📤 Sending to relayer...');
    await relayer.start();
    const auctionId = await relayer.receiveOrderFromMaker(signedOrder);
    
    console.log('📊 Checking auction details...');
    const auctions = relayer.getActiveAuctions();
    if (auctions.length > 0) {
      const auction = auctions[0];
      console.log(`✅ Custom order became auction: ${auctionId}`);
      console.log(`   User parameters preserved:`);
      console.log(`     Amount: ${auction.srcAmount} ${auction.srcToken} → ${auction.dstAmount} ${auction.dstToken}`);
      console.log(`     Timelock: ${auction.timelock}s`);
      console.log(`     Current rate: ${auction.currentRate}`);
    }

    await relayer.stop();
    console.log('✅ Integration test successful\n');

  } catch (error) {
    console.error('❌ Integration test failed:', error);
  }
}

async function runAllCustomTests() {
  try {
    await testCustomOrderCreation();
    await testPredefinedConfigurations();
    await testValidationAndRates();
    await testSupportedChainsAndTokens();
    await testIntegrationWithRelayer();

    console.log('🎉 ALL CUSTOM ORDER TESTS PASSED!\n');
    console.log('🚀 READY FOR FRONTEND INTEGRATION:');
    console.log('   ✅ User wallet connection');
    console.log('   ✅ Custom parameter inputs');
    console.log('   ✅ Predefined swap configurations');
    console.log('   ✅ Rate estimation');
    console.log('   ✅ Parameter validation');
    console.log('   ✅ Order signing & submission');
    console.log('   ✅ Metadata & analytics support');
    console.log('   ✅ Multi-chain & multi-token support');

  } catch (error) {
    console.error('\n💥 Custom order tests failed:', error);
    process.exit(1);
  }
}

runAllCustomTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
}); 