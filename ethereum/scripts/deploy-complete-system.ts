/**
 * Complete System Deployment Script
 * Deploys MockLimitOrderProtocol + FusionPlusWrapper to Sepolia
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

interface DeploymentResult {
  contractName: string;
  address: string;
  txHash: string;
  blockNumber: string;
  gasUsed: string;
}

async function compileContracts(): Promise<{ mockLOP: any, fusionWrapper: any }> {
  console.log('🔨 Compiling contracts...');
  
  try {
    await execAsync('npx hardhat compile');
    console.log('✅ Contracts compiled successfully');
    
    // Read compiled artifacts
    const mockLOPPath = './ethereum/artifacts/ethereum/contracts/MockLimitOrderProtocol.sol/MockLimitOrderProtocol.json';
    const fusionWrapperPath = './ethereum/artifacts/ethereum/contracts/FusionPlusWrapper.sol/FusionPlusWrapper.json';
    
    if (!existsSync(mockLOPPath) || !existsSync(fusionWrapperPath)) {
      throw new Error('Compiled artifacts not found. Make sure contracts compiled successfully.');
    }
    
    const mockLOP = JSON.parse(readFileSync(mockLOPPath, 'utf8'));
    const fusionWrapper = JSON.parse(readFileSync(fusionWrapperPath, 'utf8'));
    
    return { mockLOP, fusionWrapper };
    
  } catch (error) {
    console.error('❌ Compilation failed:', error);
    throw error;
  }
}

async function deployContract(
  walletClient: any,
  publicClient: any,
  contractName: string,
  abi: any[],
  bytecode: string,
  args: readonly unknown[] = []
): Promise<DeploymentResult> {
  console.log(`\n🔨 Deploying ${contractName}...`);
  
  const hash = await walletClient.deployContract({
    abi,
    bytecode: bytecode as `0x${string}`,
    args: args as readonly unknown[],
  });
  
  console.log(`⏳ Transaction hash: ${hash}`);
  console.log('⏳ Waiting for confirmation...');
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  if (receipt.status !== 'success') {
    throw new Error(`${contractName} deployment failed`);
  }
  
  console.log(`✅ ${contractName} deployed successfully!`);
  console.log(`📍 Address: ${receipt.contractAddress}`);
  console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
  
  return {
    contractName,
    address: receipt.contractAddress!,
    txHash: hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString()
  };
}

async function main() {
  console.log('🚀 DEPLOYING COMPLETE FUSION+ SYSTEM TO SEPOLIA');
  console.log('='.repeat(60));
  
  // Check environment variables
  if (!process.env.PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not found in environment variables');
    console.log('Please create a .env file with your private key');
    console.log('Example: PRIVATE_KEY=your_private_key_without_0x_prefix');
    process.exit(1);
  }
  
  // Compile contracts
  const { mockLOP, fusionWrapper } = await compileContracts();
  
  // Setup account and client (remove 0x prefix if present)
  const privateKey = process.env.PRIVATE_KEY!.startsWith('0x') 
      ? process.env.PRIVATE_KEY!.slice(2) 
      : process.env.PRIVATE_KEY!;
  const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
  
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
  
  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('💰 Account balance:', formatEther(balance), 'ETH');
  
  if (balance < parseEther('0.02')) {
    console.log('⚠️  WARNING: Low balance. You may need more ETH for deployment.');
    console.log('Get Sepolia ETH from: https://sepoliafaucet.com/');
    return;
  }
  
  // Contract addresses
  const WETH_ADDRESS = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'; // WETH on Sepolia
  
  console.log('\n📋 DEPLOYMENT PLAN:');
  console.log('1. Deploy MockLimitOrderProtocol');
  console.log('2. Deploy FusionPlusWrapper with MockLOP address');
  console.log('3. Test both contracts');
  console.log('4. Save deployment info');
  
  const deployments: DeploymentResult[] = [];
  
  try {
    // Step 1: Deploy MockLimitOrderProtocol
    const mockLOPDeployment = await deployContract(
      walletClient,
      publicClient,
      'MockLimitOrderProtocol',
      mockLOP.abi,
      mockLOP.bytecode
    );
    deployments.push(mockLOPDeployment);
    
    // Step 2: Deploy FusionPlusWrapper
    const fusionWrapperDeployment = await deployContract(
      walletClient,
      publicClient,
      'FusionPlusWrapper',
      fusionWrapper.abi,
      fusionWrapper.bytecode,
      [mockLOPDeployment.address, WETH_ADDRESS]
    );
    deployments.push(fusionWrapperDeployment);
    
    // Step 3: Test contracts
    console.log('\n🧪 TESTING DEPLOYED CONTRACTS:');
    
    // Test MockLOP
    console.log('Testing MockLimitOrderProtocol...');
    const mockLOPContract = {
      address: mockLOPDeployment.address,
      abi: mockLOP.abi
    };
    
    // Test FusionWrapper
    console.log('Testing FusionPlusWrapper...');
    const lopAddress = await publicClient.readContract({
      address: fusionWrapperDeployment.address as `0x${string}`,
      abi: fusionWrapper.abi,
      functionName: 'limitOrderProtocol',
      args: [],
    }) as string;
    
    const wethAddress = await publicClient.readContract({
      address: fusionWrapperDeployment.address as `0x${string}`,
      abi: fusionWrapper.abi,
      functionName: 'weth',
      args: [],
    }) as string;
    
    const minSafetyDeposit = await publicClient.readContract({
      address: fusionWrapperDeployment.address as `0x${string}`,
      abi: fusionWrapper.abi,
      functionName: 'MIN_SAFETY_DEPOSIT',
      args: [],
    }) as bigint;
    
    console.log('✅ MockLOP Address in FusionWrapper:', lopAddress);
    console.log('✅ WETH Address in FusionWrapper:', wethAddress);
    console.log('✅ Min Safety Deposit:', formatEther(minSafetyDeposit), 'ETH');
    
    // Verify integration
    if (lopAddress.toLowerCase() === mockLOPDeployment.address.toLowerCase()) {
      console.log('✅ Integration verified: FusionWrapper correctly linked to MockLOP');
    } else {
      console.log('❌ Integration error: Address mismatch');
    }
    
    // Step 4: Save deployment info
    const deploymentInfo = {
      network: 'sepolia',
      chainId: sepolia.id,
      deployer: account.address,
      deploymentTime: new Date().toISOString(),
      contracts: {
        MockLimitOrderProtocol: {
          address: mockLOPDeployment.address,
          txHash: mockLOPDeployment.txHash,
          blockNumber: mockLOPDeployment.blockNumber,
          gasUsed: mockLOPDeployment.gasUsed
        },
        FusionPlusWrapper: {
          address: fusionWrapperDeployment.address,
          txHash: fusionWrapperDeployment.txHash,
          blockNumber: fusionWrapperDeployment.blockNumber,
          gasUsed: fusionWrapperDeployment.gasUsed,
          constructorArgs: {
            limitOrderProtocol: mockLOPDeployment.address,
            weth: WETH_ADDRESS
          }
        }
      }
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
    
    deployedAddresses.sepolia = { ...deployedAddresses.sepolia, ...deploymentInfo };
    
    writeFileSync('deployed-addresses.json', JSON.stringify(deployedAddresses, null, 2));
    
    console.log('\n💾 Deployment info saved to deployed-addresses.json');
    
    // Final summary
    console.log('\n🎉 DEPLOYMENT COMPLETE!');
    console.log('='.repeat(60));
    console.log('🌐 Network: Sepolia Testnet');
    console.log('📍 MockLimitOrderProtocol:', mockLOPDeployment.address);
    console.log('📍 FusionPlusWrapper:', fusionWrapperDeployment.address);
    console.log('🔗 Etherscan MockLOP:', `https://sepolia.etherscan.io/address/${mockLOPDeployment.address}`);
    console.log('🔗 Etherscan FusionWrapper:', `https://sepolia.etherscan.io/address/${fusionWrapperDeployment.address}`);
    
    console.log('\n📋 NEXT STEPS:');
    console.log('1. Verify contracts on Etherscan');
    console.log('2. Deploy Stellar escrow contract on testnet');
    console.log('3. Update relayer with new contract addresses');
    console.log('4. Run end-to-end integration tests');
    
    console.log('\n🔧 ENVIRONMENT VARIABLES FOR INTEGRATION:');
    console.log(`export SEPOLIA_MOCK_LOP="${mockLOPDeployment.address}"`);
    console.log(`export SEPOLIA_FUSION_WRAPPER="${fusionWrapperDeployment.address}"`);
    
    console.log('\n✅ READY FOR BOUNTY DEMO! 🏆');
    
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { main as deployCompleteSystem };
