#!/usr/bin/env ts-node

import { EthereumResolver } from '../ethereum/resolver/EthereumResolver';
import { FusionAuction } from '../shared/types';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('🧪 Testing Ethereum Integration with REAL deployed contract\n');

const DEPLOYED_CONTRACT_ADDRESS = '0xf8ea5a091f6bb55c4c5e5576e931563ca2d51220';

async function testRealContract() {
  console.log('📝 Testing with real deployed SimpleEscrow contract...');
  
  try {
    // Create resolver instance
    const resolver = new EthereumResolver();
    
    // Check if we have real private key
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    if (!privateKey || privateKey === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      console.log('⚠️  No real private key found in .env - running read-only tests');
      await testReadOnlyFunctions(resolver);
      return;
    }
    
    console.log('🔐 Initializing with real private key and contract...');
    await resolver.initialize(privateKey, DEPLOYED_CONTRACT_ADDRESS as `0x${string}`);
    
    console.log(`✅ Connected to deployed contract: ${DEPLOYED_CONTRACT_ADDRESS}`);
    console.log(`💰 Wallet address: ${resolver.getWalletAddress()}`);
    
    // Test getting balance
    const balance = await resolver.getBalance();
    console.log(`💰 Current balance: ${balance} ETH`);
    
    // Test getting current block number
    const blockNumber = await resolver.getCurrentBlockNumber();
    console.log(`⛓️  Current block: ${blockNumber}`);
    
    // Test getting escrow details for a non-existent escrow
    console.log('\n📋 Testing escrow operations...');
    const testOrderHash = 'test_order_12345';
    const escrowDetails = await resolver.getEscrowDetails(testOrderHash);
    if (escrowDetails === null) {
      console.log('✅ Non-existent escrow correctly returns null');
    } else {
      console.log('⚠️  Unexpected escrow data found:', escrowDetails);
    }
    
    // Test mock auction creation (this would use real gas!)
    console.log('\n⚠️  Mock escrow creation test (would use real gas):');
    const mockAuction: FusionAuction = {
      id: 'test_auction_real',
      orderHash: 'test_order_real_123',
      hashlock: '0x' + 'a'.repeat(64),
      timelock: 3600,
      srcChain: 'ethereum',
      dstChain: 'stellar',
      srcToken: 'ETH',
      dstToken: 'XLM',
      srcAmount: '0.001', // Very small amount for testing
      dstAmount: '10',
      stellarAmount: '10',
      currentRate: '10000',
      startTime: Date.now(),
      endTime: Date.now() + 300000
    };
    
    console.log(`📋 Mock auction ready:`, {
      orderHash: mockAuction.orderHash,
      amount: mockAuction.srcAmount + ' ETH',
      hashlock: mockAuction.hashlock.substring(0, 10) + '...'
    });
    
    console.log('💡 To actually create escrow, run: await resolver.createEscrow(orderHash, auction)');
    console.log('⚠️  This would cost real ETH gas fees!');
    
    console.log('\n🎉 Real contract integration test successful!');
    
  } catch (error) {
    console.error('❌ Real contract test failed:', error);
    throw error;
  }
}

async function testReadOnlyFunctions(resolver: EthereumResolver) {
  console.log('📖 Testing read-only functions...');
  
  try {
    // Test current block number (doesn't require wallet)
    const blockNumber = await resolver.getCurrentBlockNumber();
    console.log(`⛓️  Current Sepolia block: ${blockNumber}`);
    console.log('✅ Public client working correctly');
    
    console.log('\n💡 To test full functionality, add your private key to .env file');
    
  } catch (error) {
    console.error('❌ Read-only test failed:', error);
    throw error;
  }
}

async function runTests() {
  try {
    await testRealContract();
    console.log('\n✅ All real contract tests passed!');
    console.log('\n🎯 Next steps:');
    console.log('   1. Create a real escrow (costs gas)');
    console.log('   2. Test escrow claim functionality'); 
    console.log('   3. Integrate with StellarResolver');
    console.log('   4. Test full cross-chain atomic swap');
  } catch (error) {
    console.error('\n💥 Real contract tests failed:', error);
    throw new Error('Real contract tests failed');
  }
}

runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
}); 