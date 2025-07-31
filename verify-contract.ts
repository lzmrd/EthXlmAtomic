#!/usr/bin/env node

/**
 * 🔍 VERIFY CONTRACT DEPLOYMENT
 * 
 * Check if the contract is deployed correctly and has the expected functions
 */

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import dotenv from 'dotenv';

dotenv.config();

const CONTRACT_ADDRESS = '0x19a8ce6c5279c6ec0682da1b823805f9c7483821';

async function verifyContract() {
  console.log(`🔍 VERIFYING CONTRACT DEPLOYMENT`);
  console.log(`===============================`);
  console.log(`📄 Contract: ${CONTRACT_ADDRESS}`);
  
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL)
  });

  try {
    // 1. Check if address has code
    console.log(`\n🔧 Checking bytecode...`);
    const code = await client.getBytecode({ address: CONTRACT_ADDRESS as `0x${string}` });
    
    if (!code || code === '0x') {
      console.log(`❌ NO BYTECODE FOUND! Contract not deployed.`);
      return;
    }
    
    console.log(`✅ Bytecode exists (${code.length} chars)`);
    console.log(`   First 100 chars: ${code.substring(0, 100)}...`);

    // 2. Check balance
    const balance = await client.getBalance({ address: CONTRACT_ADDRESS as `0x${string}` });
    console.log(`💰 Contract balance: ${Number(balance) / 1e18} ETH`);

    // 3. Try to call a simple view function
    console.log(`\n📞 Testing view functions...`);
    
    const ABI = [
      {
        inputs: [],
        name: 'escrowCounter',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function'
      },
      {
        inputs: [{ name: 'escrowId', type: 'bytes32' }],
        name: 'getEscrow',
        outputs: [
          {
            components: [
              { name: 'maker', type: 'address' },
              { name: 'resolver', type: 'address' },
              { name: 'targetAddress', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'safetyDeposit', type: 'uint256' },
              { name: 'token', type: 'address' },
              { name: 'hashlock', type: 'bytes32' },
              { name: 'finalityLock', type: 'uint256' },
              { name: 'exclusiveLock', type: 'uint256' },
              { name: 'cancellationLock', type: 'uint256' },
              { name: 'depositPhase', type: 'bool' },
              { name: 'completed', type: 'bool' }
            ],
            name: '',
            type: 'tuple'
          }
        ],
        stateMutability: 'view',
        type: 'function'
      }
    ] as const;

    try {
      const counter = await client.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: ABI,
        functionName: 'escrowCounter'
      });
      console.log(`✅ escrowCounter(): ${counter}`);
    } catch (error) {
      console.log(`❌ escrowCounter() failed: ${error}`);
    }

    try {
      const testEscrowId = '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`;
      const escrow = await client.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: ABI,
        functionName: 'getEscrow',
        args: [testEscrowId]
      });
      console.log(`✅ getEscrow() works`);
    } catch (error) {
      console.log(`❌ getEscrow() failed: ${error}`);
    }

    // 4. Check recent transactions to this contract
    console.log(`\n📊 Recent activity check...`);
    console.log(`🔗 View on Etherscan: https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`);
    console.log(`🔗 Contract verification: https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#code`);

    // 5. Let's check what happens when we try to estimate gas for createSourceEscrow
    console.log(`\n⛽ Gas estimation test...`);
    
    const createEscrowABI = [
      {
        inputs: [
          { name: 'escrowId', type: 'bytes32' },
          { name: 'maker', type: 'address' },
          { name: 'targetAddress', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'hashlock', type: 'bytes32' },
          { name: 'finalityDuration', type: 'uint256' },
          { name: 'exclusiveDuration', type: 'uint256' },
          { name: 'cancellationDuration', type: 'uint256' }
        ],
        name: 'createSourceEscrow',
        outputs: [],
        stateMutability: 'payable',
        type: 'function'
      }
    ] as const;

    try {
      const gasEstimate = await client.estimateContractGas({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: createEscrowABI,
        functionName: 'createSourceEscrow',
        args: [
          '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`,
          '0xBE7E687e50889E8F4d7ec7d968Ddef132D04313a' as `0x${string}`,
          '0xBE7E687e50889E8F4d7ec7d968Ddef132D04313a' as `0x${string}`,
          BigInt('1000000000000000'),
          '0x0000000000000000000000000000000000000000' as `0x${string}`,
          '0x022ea3eb4ed91bd41ad479312be54ba088b7d5e5c6b2b99c690df695e9cba62d' as `0x${string}`,
          BigInt(300),
          BigInt(600),
          BigInt(1200)
        ],
        account: '0x8b1C2B3E79Ca44C0862d7B3cfCC0F792dDB1B167' as `0x${string}`,
        value: BigInt('1100000000000000')
      });
      
      console.log(`✅ Gas estimate: ${gasEstimate}`);
    } catch (error) {
      console.log(`❌ Gas estimation failed: ${error}`);
      
      // Extract revert reason if possible
      if (error instanceof Error && error.message.includes('execution reverted')) {
        console.log(`🔍 This suggests the contract is working but reverting for a specific reason`);
      }
    }

  } catch (error) {
    console.error(`❌ Error verifying contract:`, error);
  }
}

verifyContract().catch(console.error); 