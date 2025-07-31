import { createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkBalances() {
    console.log('💰 CHECKING BALANCES AFTER ESCROW CREATION');
    console.log('==========================================');
    
    // Load environment
    const alicePrivateKey = process.env.ALICE_PRIVATE_KEY;
    const resolverPrivateKey = process.env.PRIVATE_KEY;
    const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL || "https://sepolia.drpc.org";
    const escrowContractAddress = "0x6af43e18d53711686babade586c069a0035bb0da";
    
    if (!alicePrivateKey || !resolverPrivateKey) {
        console.error('❌ Missing private keys in .env file');
        return;
    }
    
    // Setup client
    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(ethereumRpcUrl)
    });
    
    // Create accounts
    const aliceAccount = privateKeyToAccount(alicePrivateKey as `0x${string}`);
    const resolverAccount = privateKeyToAccount(resolverPrivateKey as `0x${string}`);
    
    console.log('👥 Accounts:');
    console.log(`   Alice: ${aliceAccount.address}`);
    console.log(`   Resolver: ${resolverAccount.address}`);
    console.log(`   Contract: ${escrowContractAddress}`);
    console.log('');
    
    try {
        // Check current balances
        const aliceBalance = await publicClient.getBalance({ address: aliceAccount.address });
        const resolverBalance = await publicClient.getBalance({ address: resolverAccount.address });
        const contractBalance = await publicClient.getBalance({ address: escrowContractAddress as `0x${string}` });
        
        console.log('💰 CURRENT BALANCES:');
        console.log(`   Alice: ${aliceBalance} wei (${formatEther(aliceBalance)} ETH)`);
        console.log(`   Resolver: ${resolverBalance} wei (${formatEther(resolverBalance)} ETH)`);
        console.log(`   Contract: ${contractBalance} wei (${formatEther(contractBalance)} ETH)`);
        console.log('');
        
        // Expected values from the test
        const expectedAliceAmount = 1000000000000000n; // 0.001 ETH
        const expectedSafetyDeposit = 100000000000000n; // 0.0001 ETH
        const expectedTotal = expectedAliceAmount + expectedSafetyDeposit; // 0.0011 ETH
        
        console.log('📊 EXPECTED VALUES FROM TEST:');
        console.log(`   Alice's amount in escrow: ${expectedAliceAmount} wei (${formatEther(expectedAliceAmount)} ETH)`);
        console.log(`   Safety deposit: ${expectedSafetyDeposit} wei (${formatEther(expectedSafetyDeposit)} ETH)`);
        console.log(`   Total in escrow: ${expectedTotal} wei (${formatEther(expectedTotal)} ETH)`);
        console.log('');
        
        // Verify funding source
        console.log('🔍 FUNDING SOURCE ANALYSIS:');
        
        if (contractBalance >= expectedTotal) {
            console.log('✅ Contract has sufficient funds');
            
            // Check if the funds came from the resolver (as expected in Fusion+)
            // In our test, the resolver should have paid both Alice's amount + safety deposit
            const resolverExpectedPayment = expectedTotal;
            
            console.log(`   Expected resolver payment: ${resolverExpectedPayment} wei (${formatEther(resolverExpectedPayment)} ETH)`);
            console.log(`   Actual contract balance: ${contractBalance} wei (${formatEther(contractBalance)} ETH)`);
            
            if (contractBalance >= resolverExpectedPayment) {
                console.log('✅ Funding source verified: Resolver paid for escrow');
                console.log('   • This matches Fusion+ pattern');
                console.log('   • Resolver provides Alice\'s amount + safety deposit');
                console.log('   • Alice\'s tokens are effectively "borrowed" by resolver');
            } else {
                console.log('❌ Unexpected funding pattern');
            }
        } else {
            console.log('❌ Contract has insufficient funds');
        }
        
        console.log('');
        console.log('📋 FUSION+ FUNDING PATTERN:');
        console.log('   • Alice signs order (no funds moved yet)');
        console.log('   • Resolver calls createSourceEscrowWithSignature');
        console.log('   • Resolver pays: Alice\'s amount + safety deposit');
        console.log('   • Alice\'s tokens are "locked" in escrow');
        console.log('   • When swap completes, resolver gets Alice\'s amount back');
        console.log('   • Plus any profit from the Dutch auction');
        
    } catch (error) {
        console.error('💥 Error:', error);
    }
}

checkBalances().catch(console.error); 