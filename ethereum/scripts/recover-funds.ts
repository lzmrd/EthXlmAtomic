import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseEther,
  formatEther,
  keccak256,
  encodePacked,
  type Address,
  type Hash
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load deployed contract info
const deployedAddresses = JSON.parse(readFileSync('ethereum/deployed-addresses.json', 'utf8'));
const FUSION_ESCROW_ADDRESS = deployedAddresses.contracts.FusionEscrow as Address;

// Load contract artifact
const artifactPath = join(__dirname, '../artifacts/ethereum/contracts/SimpleEscrow.sol/FusionEscrow.json');
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

async function recoverFunds() {
  console.log("🆘 FUSION+ FUND RECOVERY SCRIPT");
  console.log("================================\n");

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  if (!privateKey) {
    console.error("❌ Please set PRIVATE_KEY in your .env file");
    process.exit(1);
  }

  // Create clients
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http("https://sepolia.drpc.org")
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http("https://sepolia.drpc.org")
  });

  console.log(`🔐 Recovery wallet: ${account.address}`);
  console.log(`📋 Contract: ${FUSION_ESCROW_ADDRESS}`);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Current balance: ${formatEther(balance)} ETH\n`);

  // Get current timestamp
  const currentBlock = await publicClient.getBlock();
  const currentTime = Number(currentBlock.timestamp);
  console.log(`⏰ Current time: ${currentTime} (${new Date(currentTime * 1000).toLocaleString()})\n`);

  try {
    // Check contract balance first
    const contractBalance = await publicClient.getBalance({ address: FUSION_ESCROW_ADDRESS });
    console.log(`💰 Contract balance: ${formatEther(contractBalance)} ETH`);
    
    if (contractBalance === 0n) {
      console.log("✅ Contract has no balance - funds already recovered or never deposited");
      return;
    }

    // Test escrow ID from previous test (maker + resolver + amount + token + hashlock)
    const testSecret = "test-secret-12345";
    const testHashlock = keccak256(encodePacked(['string'], [testSecret]));
    const testEscrowId = keccak256(encodePacked(
      ['address', 'address', 'uint256', 'address', 'bytes32'],
      [account.address, account.address, parseEther('0.01'), '0x0000000000000000000000000000000000000000', testHashlock]
    ));
    
    console.log(`🔍 Checking test escrow: ${testEscrowId}`);
    
    // Get escrow details
    const escrowData = await publicClient.readContract({
      address: FUSION_ESCROW_ADDRESS,
      abi: artifact.abi,
      functionName: 'getEscrow',
      args: [testEscrowId]
    }) as any;

    console.log("\n📊 ESCROW STATUS:");
    console.log(`   Maker: ${escrowData.maker}`);
    console.log(`   Resolver: ${escrowData.resolver}`);
    console.log(`   Amount: ${formatEther(escrowData.amount)} ETH`);
    console.log(`   Safety Deposit: ${formatEther(escrowData.safetyDeposit)} ETH`);
    console.log(`   Completed: ${escrowData.completed}`);
    console.log(`   Finality Lock: ${escrowData.finalityLock} (${new Date(Number(escrowData.finalityLock) * 1000).toLocaleString()})`);
    console.log(`   Exclusive Lock: ${escrowData.exclusiveLock} (${new Date(Number(escrowData.exclusiveLock) * 1000).toLocaleString()})`);
    console.log(`   Cancellation Lock: ${escrowData.cancellationLock} (${new Date(Number(escrowData.cancellationLock) * 1000).toLocaleString()})`);

    if (escrowData.completed) {
      console.log("✅ Escrow already completed - funds should be recovered");
      return;
    }

    if (escrowData.maker === '0x0000000000000000000000000000000000000000') {
      console.log("❌ Escrow not found - checking for other escrows...");
      
      // Try to get escrow count and check recent escrows
      const escrowCount = await publicClient.readContract({
        address: FUSION_ESCROW_ADDRESS,
        abi: artifact.abi,
        functionName: 'getEscrowCount',
        args: []
      }) as bigint;
      
      console.log(`📊 Total escrows created: ${escrowCount}`);
      return;
    }

    // Determine recovery method based on current time
    const finalityLock = Number(escrowData.finalityLock);
    const exclusiveLock = Number(escrowData.exclusiveLock);
    const cancellationLock = Number(escrowData.cancellationLock);

    console.log("\n🔄 RECOVERY OPTIONS:");

    if (currentTime < finalityLock) {
      console.log("⏳ Still in FINALITY LOCK period - must wait until:", new Date(finalityLock * 1000).toLocaleString());
      const waitTime = finalityLock - currentTime;
      console.log(`   Wait time: ${waitTime} seconds (${Math.ceil(waitTime/60)} minutes)`);
      return;
    }

    if (currentTime < exclusiveLock) {
      console.log("🔓 In EXCLUSIVE CLAIM period - trying to claim with secret...");
      
      try {
        const hash = await walletClient.writeContract({
          address: FUSION_ESCROW_ADDRESS,
          abi: artifact.abi,
          functionName: 'claimExclusive',
          args: [testEscrowId, testHashlock],
          account: account,
          gas: 400000n
        });

        console.log(`⏳ Claim transaction sent: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`✅ Funds claimed successfully! Block: ${receipt.blockNumber}`);
        
        // Check new balance
        const newBalance = await publicClient.getBalance({ address: account.address });
        console.log(`💰 New balance: ${formatEther(newBalance)} ETH`);
        return;
      } catch (error) {
        console.log("❌ Claim failed (maybe wrong secret):", error);
        console.log("⏳ Will try cancellation after exclusive period...");
      }
    }

    if (currentTime >= exclusiveLock && currentTime < cancellationLock) {
      console.log("🌍 In PUBLIC CLAIM period - trying public claim...");
      
      try {
        const hash = await walletClient.writeContract({
          address: FUSION_ESCROW_ADDRESS,
          abi: artifact.abi,
          functionName: 'claimPublic',
          args: [testEscrowId, testHashlock],
          account: account,
          gas: 400000n
        });

        console.log(`⏳ Public claim transaction sent: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`✅ Funds claimed publicly! Block: ${receipt.blockNumber}`);
        
        const newBalance = await publicClient.getBalance({ address: account.address });
        console.log(`💰 New balance: ${formatEther(newBalance)} ETH`);
        return;
      } catch (error) {
        console.log("❌ Public claim failed:", error);
      }
    }

    if (currentTime >= cancellationLock) {
      console.log("❌ In CANCELLATION period - trying to cancel and recover funds...");
      
      try {
        // Try exclusive cancel first (if we're the resolver)
        const hash = await walletClient.writeContract({
          address: FUSION_ESCROW_ADDRESS,
          abi: artifact.abi,
          functionName: 'cancelExclusive',
          args: [testEscrowId],
          account: account,
          gas: 400000n
        });

        console.log(`⏳ Cancel transaction sent: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`✅ Escrow cancelled and funds recovered! Block: ${receipt.blockNumber}`);
        
        const newBalance = await publicClient.getBalance({ address: account.address });
        console.log(`💰 New balance: ${formatEther(newBalance)} ETH`);
        return;
      } catch (error) {
        console.log("❌ Exclusive cancel failed, trying public cancel...", error);
        
        try {
          const hash = await walletClient.writeContract({
            address: FUSION_ESCROW_ADDRESS,
            abi: artifact.abi,
            functionName: 'cancelPublic',
            args: [testEscrowId],
            account: account,
            gas: 400000n
          });

          console.log(`⏳ Public cancel transaction sent: ${hash}`);
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          console.log(`✅ Escrow cancelled publicly! Block: ${receipt.blockNumber}`);
          
          const newBalance = await publicClient.getBalance({ address: account.address });
          console.log(`💰 New balance: ${formatEther(newBalance)} ETH`);
          return;
        } catch (error2) {
          console.log("❌ Public cancel also failed:", error2);
        }
      }
    }

    console.log("\n🆘 If all recovery methods failed, you may need to:");
    console.log("   1. Wait for the cancellation period");
    console.log("   2. Use emergencyWithdraw after 30 days (maker only)");
    console.log("   3. Check if there are other escrows with different IDs");

  } catch (error) {
    console.error("💥 Recovery failed:", error);
  }
}

recoverFunds()
  .then(() => {
    console.log("\n✅ Recovery script completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Recovery script failed:", error);
    process.exit(1);
  }); 