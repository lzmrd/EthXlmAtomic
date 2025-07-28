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
import { CONTRACT_ADDRESSES } from "../../shared/constants";
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load SimpleEscrow compilation artifact  
const artifactPath = require('path').join(__dirname, '../artifacts/SimpleEscrow.json');
const artifact = JSON.parse(require('fs').readFileSync(artifactPath, 'utf8'));

const SIMPLE_ESCROW_BYTECODE = artifact.bytecode;

async function main() {
  console.log("🚀 Starting Ethereum contract deployment with Viem...\n");

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey || privateKey === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    console.error("❌ Please set a valid PRIVATE_KEY in your .env file");
    console.error("💡 Copy env.example to .env and update with your values");
    process.exit(1);
  }

  // Get RPC URL from environment
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org";
  console.log(`🌐 Using RPC: ${rpcUrl.substring(0, 30)}...`);

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
    console.log("📝 Deploying SimpleEscrow...");
    console.log(`🔗 Bytecode length: ${SIMPLE_ESCROW_BYTECODE.length} characters`);
    
    // Deploy the contract with the real compiled bytecode
    const hash = await walletClient!.deployContract({
      abi: artifact.abi,
      bytecode: SIMPLE_ESCROW_BYTECODE as `0x${string}`,
      args: [],
      account: account,
      chain: sepolia,
      gas: 2000000n
    });

    console.log(`⏳ Contract deployment transaction sent: ${hash}`);
    
    // Wait for transaction receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const contractAddress = receipt.contractAddress;
    
    if (!contractAddress) {
      throw new Error('Contract deployment failed - no address returned');
    }
    
    console.log(`✅ SimpleEscrow deployed to: ${contractAddress}`);

    // Save deployed addresses to a file
    const deployedAddresses = {
      network: {
        name: sepolia.name,
        chainId: sepolia.id,
        rpcUrl: process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org"
      },
      timestamp: new Date().toISOString(),
      contracts: {
        SimpleEscrow: contractAddress
      },
      deployer: account.address,
      deploymentMethod: "viem"
    };

    // Create ethereum directory if it doesn't exist
    if (!fs.existsSync('ethereum')) {
      fs.mkdirSync('ethereum');
    }

    fs.writeFileSync(
      'ethereum/deployed-addresses.json',
      JSON.stringify(deployedAddresses, null, 2)
    );

    console.log("\n🎉 Deployment preparation completed!");
    console.log("📄 Contract addresses saved to ethereum/deployed-addresses.json");
    console.log("\n📋 Next steps:");
    console.log("   1. Compile SimpleEscrow.sol to get bytecode");
    console.log("   2. Replace mock address with real deployed contract");
    console.log("   3. Test deployment with EthereumResolver");
    
  } catch (error) {
    console.error("💥 Deployment failed:", error);
    process.exit(1);
  }
}

// Helper function to compile contract (would use solc in real scenario)
function compileContract() {
  console.log("🔧 Contract compilation would happen here");
  console.log("   - Use solc or forge to compile SimpleEscrow.sol");
  console.log("   - Extract bytecode and ABI");
  console.log("   - Return compiled artifacts");
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