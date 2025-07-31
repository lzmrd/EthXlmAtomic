/**
 * Complete Compile and Deploy Script for FusionPlusWrapper
 * Uses viem for deployment and includes contract compilation
 */

import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';

const execAsync = promisify(exec);
dotenv.config();

async function compileContract(): Promise<{ abi: any[], bytecode: string }> {
  console.log('🔨 Compiling FusionPlusWrapper contract...');
  
  try {
    // Compile using hardhat
    await execAsync('npx hardhat compile');
    console.log('✅ Contract compiled successfully');
    
    // Read compiled artifacts
    const artifactPath = './artifacts/contracts/FusionPlusWrapper.sol/FusionPlusWrapper.json';
    
    if (!existsSync(artifactPath)) {
      throw new Error('Compiled artifact not found. Make sure the contract compiled successfully.');
    }
    
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    
    return {
      abi: artifact.abi,
      bytecode: artifact.bytecode
    };
    
  } catch (error) {
    console.error('❌ Compilation failed:', error);
    throw error;
  }
}

async function deployContract() {
  console.log('🚀 DEPLOYING FUSION+ WRAPPER TO SEPOLIA');
  console.log('='.repeat(55));
  
  // Check environment variables
  if (!process.env.PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not found in environment variables');
    console.log('Please create a .env file with your private key');
    process.exit(1);
  }
  
  // Compile contract first
  const { abi, bytecode } = await compileContract();
  
  // Setup account and clients
  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}` as `0x${string}`);
  
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org')
  });
  
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org')
  });
  
  console.log('📝 Deploying with account:', account.address);
  
  // Get balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('💰 Account balance:', formatEther(balance), 'ETH');
  
  if (balance < parseEther('0.01')) {
    console.log('⚠️  WARNING: Low balance. You may need more ETH for deployment.');
    console.log('Get Sepolia ETH from: https://sepoliafaucet.com/');
    return;
  }
  
  // Contract addresses
  const MOCK_LOP_ADDRESS = '0x0000000000000000000000000000000000000001'; // Placeholder
  const WETH_ADDRESS = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'; // WETH on Sepolia
  
  console.log('\\n📋 DEPLOYMENT PARAMETERS:');
  console.log('   LOP Contract:', MOCK_LOP_ADDRESS);
  console.log('   WETH Address:', WETH_ADDRESS);
  console.log('   Chain ID:', sepolia.id);
  console.log('   Bytecode size:', bytecode.length / 2 - 1, 'bytes');
  
  try {
    console.log('\\n🔨 Deploying contract...');
    
    // Deploy the contract
    const hash = await walletClient.deployContract({
      abi,
      bytecode: bytecode as `0x${string}`,
      args: [MOCK_LOP_ADDRESS, WETH_ADDRESS],
    });
    
    console.log('⏳ Transaction hash:', hash);
    console.log('⏳ Waiting for confirmation...');
    
    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    if (receipt.status === 'success') {
      console.log('✅ Contract deployed successfully!');
      console.log('📍 Contract address:', receipt.contractAddress);
      console.log('⛽ Gas used:', receipt.gasUsed.toString());
      console.log('💰 Gas price:', receipt.effectiveGasPrice?.toString());
      
      // Test contract functionality
      if (receipt.contractAddress) {
        await testContractFunctionality(publicClient, receipt.contractAddress, abi);
      }
      
      // Save deployment info
      const deploymentInfo = {
        network: 'sepolia',
        contractName: 'FusionPlusWrapper',
        address: receipt.contractAddress,
        deployer: account.address,
        deploymentTime: new Date().toISOString(),
        txHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        constructorArgs: {
          limitOrderProtocol: MOCK_LOP_ADDRESS,
          weth: WETH_ADDRESS
        },
        chainId: sepolia.id
      };
      
      // Update deployed addresses file
      let deployedAddresses: any = {};
      try {
        const existing = readFileSync('deployed-addresses.json', 'utf8');
        deployedAddresses = JSON.parse(existing);
      } catch (error) {
        // File doesn't exist, start fresh
      }
      
      if (!deployedAddresses.sepolia) {
        deployedAddresses.sepolia = {};
      }
      
      deployedAddresses.sepolia.FusionPlusWrapper = deploymentInfo;
      
      writeFileSync('deployed-addresses.json', JSON.stringify(deployedAddresses, null, 2));
      
      console.log('\\n💾 Deployment info saved to deployed-addresses.json');
      
      console.log('\\n🎉 DEPLOYMENT COMPLETE!');
      console.log('='.repeat(50));
      console.log('📍 Contract Address:', receipt.contractAddress);
      console.log('🌐 Network: Sepolia Testnet');
      console.log('🔗 Etherscan:', `https://sepolia.etherscan.io/address/${receipt.contractAddress}`);
      
      console.log('\\n📋 NEXT STEPS:');
      console.log('1. Verify contract on Etherscan');
      console.log('2. Deploy Stellar escrow contract on testnet');
      console.log('3. Update relayer with new contract addresses');
      console.log('4. Run end-to-end integration tests');
      
      console.log('\\n🔧 INTEGRATION COMMANDS:');
      console.log(`export SEPOLIA_FUSION_WRAPPER="${receipt.contractAddress}"`);
      
    } else {
      console.log('❌ Deployment failed - transaction reverted');
    }
    
  } catch (error) {
    console.error('❌ Deployment error:', error);
    throw error;
  }
}

async function testContractFunctionality(publicClient: any, contractAddress: string, abi: any[]) {
  console.log('\\n🧪 TESTING CONTRACT FUNCTIONALITY:');
  
  try {
    // Test reading contract state
    const lopAddress = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'limitOrderProtocol',
    });
    
    const wethAddress = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'weth',
    });
    
    const minSafetyDeposit = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'MIN_SAFETY_DEPOSIT',
    });
    
    console.log('✅ LOP Address:', lopAddress);
    console.log('✅ WETH Address:', wethAddress);
    console.log('✅ Min Safety Deposit:', formatEther(minSafetyDeposit), 'ETH');
    
  } catch (error) {
    console.log('⚠️  Error testing functionality:', error);
  }
}

// Main execution
async function main() {
  try {
    await deployContract();
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { deployContract, compileContract };
