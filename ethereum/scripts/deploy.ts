import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseEther,
  formatEther,
  getContract,
  type Address,
  type Hash
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load FusionEscrow compilation artifact from correct path  
const artifactPath = require('path').join(__dirname, '../artifacts/contracts/SimpleEscrow.sol/FusionEscrow.json');
const artifact = JSON.parse(require('fs').readFileSync(artifactPath, 'utf8'));

const FUSION_ESCROW_BYTECODE = artifact.bytecode;

async function main() {
  console.log("🚀 Starting FusionEscrow deployment on Sepolia...\n");

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey || privateKey === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    console.error("❌ Please set a valid PRIVATE_KEY in your .env file");
    console.error("💡 Copy env.example to .env and update with your values");
    process.exit(1);
  }

  // Get RPC URL from environment
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org";
  console.log(`🌐 Network: ${sepolia.name}`);
  console.log(`🌐 RPC URL: ${rpcUrl.substring(0, 50)}...`);

  // Create clients
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl)
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl)
  });

  console.log("Deploying contracts with account:", account.address);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Account balance:", formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.error("❌ Account has no ETH balance. Please fund the account with Sepolia ETH.");
    console.log("💡 Get Sepolia ETH from: https://faucet.sepolia.org/");
    process.exit(1);
  }

  try {
    console.log("📝 Deploying FusionEscrow...");
    console.log(`🔗 Bytecode length: ${FUSION_ESCROW_BYTECODE.length} characters`);
    
    // Deploy the contract
    const hash = await walletClient!.deployContract({
      abi: artifact.abi,
      bytecode: FUSION_ESCROW_BYTECODE as `0x${string}`,
      args: [],
      account: account,
      chain: sepolia,
      gas: 3000000n // Increased gas limit for complex contract
    });

    console.log(`⏳ Contract deployment transaction sent: ${hash}`);
    console.log(`🔗 View on Etherscan: https://sepolia.etherscan.io/tx/${hash}`);
    
    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const contractAddress = receipt.contractAddress;
    
    if (!contractAddress) {
      throw new Error('Contract deployment failed - no address returned');
    }
    
    console.log(`✅ FusionEscrow deployed to: ${contractAddress}`);
    console.log(`🔗 View contract: https://sepolia.etherscan.io/address/${contractAddress}`);

    // Save deployed addresses to a file
    const deployedAddresses = {
      network: {
        name: sepolia.name,
        chainId: sepolia.id,
        rpcUrl: rpcUrl
      },
      timestamp: new Date().toISOString(),
      contracts: {
        FusionEscrow: contractAddress
      },
      deployer: account.address,
      deploymentMethod: "viem",
      txHash: hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber.toString()
    };

    // Create ethereum directory if it doesn't exist
    if (!fs.existsSync('ethereum')) {
      fs.mkdirSync('ethereum');
    }

    fs.writeFileSync(
      'ethereum/deployed-addresses.json',
      JSON.stringify(deployedAddresses, null, 2)
    );

    console.log("\n🎉 FusionEscrow deployment completed successfully!");
    console.log("📄 Contract addresses saved to ethereum/deployed-addresses.json");
    console.log("\n📋 Contract info:");
    console.log(`   📍 Address: ${contractAddress}`);
    console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`   🧱 Block: ${receipt.blockNumber.toString()}`);
    console.log(`   🌐 Network: ${sepolia.name} (${sepolia.id})`);
    console.log(`   🔗 Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);
    
    console.log("\n🧪 Ready for Fusion+ testing!");
    console.log("   - Contract deployed on Sepolia testnet");
    console.log("   - Use EthereumResolver.ts to interact with it");
    console.log("   - All Fusion+ features (safety deposits, timelock phases) are active");
    
  } catch (error) {
    console.error("💥 Deployment failed:", error);
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n✅ Deploy script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Deploy script failed:", error);
    process.exit(1);
  }); 