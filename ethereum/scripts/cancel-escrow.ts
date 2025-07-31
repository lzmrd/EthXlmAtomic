import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  formatEther
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function cancelEscrow() {
  console.log("❌ CANCELLING ESCROW TO RECOVER FUNDS");
  console.log("====================================\n");

  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  
  const deployedAddresses = JSON.parse(readFileSync('ethereum/deployed-addresses.json', 'utf8'));
  const FUSION_ESCROW_ADDRESS = deployedAddresses.contracts.FusionEscrow;
  const artifactPath = join(__dirname, '../artifacts/ethereum/contracts/SimpleEscrow.sol/FusionEscrow.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http("https://sepolia.drpc.org")
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http("https://sepolia.drpc.org")
  });

  const ESCROW_ID = '0xd62a00bd217a6401ac545a1bbe9c1017a538cb21436cf85029a51f7b04150f4b';

  console.log(`🔐 Account: ${account.address}`);
  console.log(`📋 Escrow ID: ${ESCROW_ID}`);
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Current balance: ${formatEther(balance)} ETH\n`);

  try {
    console.log("❌ Attempting to cancel escrow...");
    
    const hash = await walletClient.writeContract({
      address: FUSION_ESCROW_ADDRESS,
      abi: artifact.abi,
      functionName: 'cancelExclusive',
      args: [ESCROW_ID],
      account: account,
      gas: 400000n
    });

    console.log(`⏳ Cancel transaction sent: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Escrow cancelled successfully! Block: ${receipt.blockNumber}`);
    
    const newBalance = await publicClient.getBalance({ address: account.address });
    console.log(`💰 New balance: ${formatEther(newBalance)} ETH`);
    console.log(`🎉 Recovered: ${formatEther(newBalance - balance)} ETH`);
    
  } catch (error) {
    console.error("❌ Cancel failed:", error);
    console.log("\n💡 If cancellation failed, wait a bit more or try cancelPublic");
  }
}

cancelEscrow().then(() => process.exit(0)).catch(console.error); 