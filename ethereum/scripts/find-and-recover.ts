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

async function findAndRecoverFunds() {
  console.log("🔍 FUSION+ ESCROW FINDER & RECOVERY");
  console.log("===================================\n");

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

  // Check contract balance
  const contractBalance = await publicClient.getBalance({ address: FUSION_ESCROW_ADDRESS });
  console.log(`💰 Contract balance: ${formatEther(contractBalance)} ETH`);
  
  if (contractBalance === 0n) {
    console.log("✅ Contract has no balance - funds already recovered");
    return;
  }

  try {
    // Get contract creation block (to search events from deployment)
    const deployBlock = BigInt(deployedAddresses.blockNumber);
    console.log(`📍 Searching events from block: ${deployBlock}`);

    // Get all SourceEscrowCreated events
    console.log("\n🔍 Searching for SourceEscrowCreated events...");
    const sourceEvents = await publicClient.getLogs({
      address: FUSION_ESCROW_ADDRESS,
      event: {
        type: 'event',
        name: 'SourceEscrowCreated',
        inputs: [
          { indexed: true, name: 'escrowId', type: 'bytes32' },
          { indexed: true, name: 'maker', type: 'address' },
          { indexed: true, name: 'resolver', type: 'address' },
          { indexed: false, name: 'amount', type: 'uint256' },
          { indexed: false, name: 'safetyDeposit', type: 'uint256' },
          { indexed: false, name: 'finalityLock', type: 'uint256' }
        ]
      },
      fromBlock: deployBlock,
      toBlock: 'latest'
    });

    // Get all DestinationEscrowCreated events
    console.log("🔍 Searching for DestinationEscrowCreated events...");
    const destEvents = await publicClient.getLogs({
      address: FUSION_ESCROW_ADDRESS,
      event: {
        type: 'event',
        name: 'DestinationEscrowCreated',
        inputs: [
          { indexed: true, name: 'escrowId', type: 'bytes32' },
          { indexed: true, name: 'maker', type: 'address' },
          { indexed: true, name: 'resolver', type: 'address' },
          { indexed: false, name: 'amount', type: 'uint256' },
          { indexed: false, name: 'safetyDeposit', type: 'uint256' },
          { indexed: false, name: 'finalityLock', type: 'uint256' }
        ]
      },
      fromBlock: deployBlock,
      toBlock: 'latest'
    });

    const allEvents = [...sourceEvents, ...destEvents];
    console.log(`📊 Found ${allEvents.length} escrow creation events\n`);

    if (allEvents.length === 0) {
      console.log("❌ No escrow events found. Something went wrong...");
      return;
    }

    // Process each escrow
    for (let i = 0; i < allEvents.length; i++) {
      const event = allEvents[i];
      const args = event.args as any;
      
      console.log(`\n🔍 Processing escrow ${i + 1}/${allEvents.length}:`);
      console.log(`   📋 ID: ${args.escrowId}`);
      console.log(`   👤 Maker: ${args.maker}`);
      console.log(`   🔧 Resolver: ${args.resolver}`);
      console.log(`   💰 Amount: ${formatEther(args.amount)} ETH`);
      console.log(`   🛡️ Safety Deposit: ${formatEther(args.safetyDeposit)} ETH`);

      // Get full escrow details
      const escrowData = await publicClient.readContract({
        address: FUSION_ESCROW_ADDRESS,
        abi: artifact.abi,
        functionName: 'getEscrow',
        args: [args.escrowId]
      }) as any;

      if (escrowData.completed) {
        console.log("   ✅ Already completed - skipping");
        continue;
      }

      // Get current time
      const currentBlock = await publicClient.getBlock();
      const currentTime = Number(currentBlock.timestamp);
      
      const finalityLock = Number(escrowData.finalityLock);
      const exclusiveLock = Number(escrowData.exclusiveLock);
      const cancellationLock = Number(escrowData.cancellationLock);

      console.log(`   ⏰ Current: ${new Date(currentTime * 1000).toLocaleString()}`);
      console.log(`   🔒 Finality: ${new Date(finalityLock * 1000).toLocaleString()}`);
      console.log(`   🔓 Exclusive: ${new Date(exclusiveLock * 1000).toLocaleString()}`);
      console.log(`   ❌ Cancellation: ${new Date(cancellationLock * 1000).toLocaleString()}`);

      // Try to recover this specific escrow
      try {
        const recovered = await recoverSpecificEscrow(
          walletClient, 
          publicClient, 
          args.escrowId, 
          escrowData, 
          currentTime,
          account.address
        );
        
        if (recovered) {
          console.log(`   ✅ Successfully recovered funds from escrow ${args.escrowId}`);
          
          // Check new balance
          const newBalance = await publicClient.getBalance({ address: account.address });
          console.log(`   💰 New balance: ${formatEther(newBalance)} ETH`);
          
          // Break after successful recovery (if desired)
          // break; 
        } else {
          console.log(`   ⏳ Could not recover yet - may need to wait for timelock`);
        }
      } catch (error) {
        console.log(`   ❌ Recovery failed for this escrow: ${error}`);
      }
    }

    console.log("\n📊 RECOVERY SUMMARY:");
    const finalBalance = await publicClient.getBalance({ address: account.address });
    const finalContractBalance = await publicClient.getBalance({ address: FUSION_ESCROW_ADDRESS });
    console.log(`💰 Your balance: ${formatEther(finalBalance)} ETH`);
    console.log(`💰 Contract balance: ${formatEther(finalContractBalance)} ETH`);

  } catch (error) {
    console.error("💥 Recovery failed:", error);
  }
}

async function recoverSpecificEscrow(
  walletClient: any,
  publicClient: any,
  escrowId: string,
  escrowData: any,
  currentTime: number,
  accountAddress: string
): Promise<boolean> {
  
  const finalityLock = Number(escrowData.finalityLock);
  const exclusiveLock = Number(escrowData.exclusiveLock);
  const cancellationLock = Number(escrowData.cancellationLock);

  // Still in finality lock
  if (currentTime < finalityLock) {
    console.log("   ⏳ Still in finality lock period");
    return false;
  }

  // Try claim with test secret first (if we know it)
  const testSecret = "test-secret-12345";
  const testHashlock = keccak256(encodePacked(['string'], [testSecret]));

  // Exclusive claim period
  if (currentTime >= finalityLock && currentTime < exclusiveLock) {
    console.log("   🔓 In exclusive claim period - trying claim...");
    
    try {
      const hash = await walletClient.writeContract({
        address: FUSION_ESCROW_ADDRESS,
        abi: artifact.abi,
        functionName: 'claimExclusive',
        args: [escrowId, testHashlock],
        account: accountAddress,
        gas: 400000n
      });

      console.log(`   ⏳ Claim tx: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("   ✅ Claimed successfully!");
      return true;
    } catch (error) {
      console.log("   ❌ Claim failed - wrong secret or not authorized");
    }
  }

  // Public claim period
  if (currentTime >= exclusiveLock && currentTime < cancellationLock) {
    console.log("   🌍 In public claim period - trying public claim...");
    
    try {
      const hash = await walletClient.writeContract({
        address: FUSION_ESCROW_ADDRESS,
        abi: artifact.abi,
        functionName: 'claimPublic',
        args: [escrowId, testHashlock],
        account: accountAddress,
        gas: 400000n
      });

      console.log(`   ⏳ Public claim tx: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("   ✅ Public claim successful!");
      return true;
    } catch (error) {
      console.log("   ❌ Public claim failed - wrong secret");
    }
  }

  // Cancellation period
  if (currentTime >= cancellationLock) {
    console.log("   ❌ In cancellation period - trying cancel...");
    
    // Try exclusive cancel first (if we're the resolver)
    try {
      const hash = await walletClient.writeContract({
        address: FUSION_ESCROW_ADDRESS,
        abi: artifact.abi,
        functionName: 'cancelExclusive',
        args: [escrowId],
        account: accountAddress,
        gas: 400000n
      });

      console.log(`   ⏳ Cancel tx: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("   ✅ Cancelled successfully!");
      return true;
    } catch (error) {
      console.log("   ❌ Exclusive cancel failed, trying public...");
      
      // Try public cancel
      try {
        const hash = await walletClient.writeContract({
          address: FUSION_ESCROW_ADDRESS,
          abi: artifact.abi,
          functionName: 'cancelPublic',
          args: [escrowId],
          account: accountAddress,
          gas: 400000n
        });

        console.log(`   ⏳ Public cancel tx: ${hash}`);
        await publicClient.waitForTransactionReceipt({ hash });
        console.log("   ✅ Public cancel successful!");
        return true;
      } catch (error2) {
        console.log("   ❌ Public cancel also failed");
      }
    }
  }

  return false;
}

findAndRecoverFunds()
  .then(() => {
    console.log("\n✅ Find and recovery script completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  }); 