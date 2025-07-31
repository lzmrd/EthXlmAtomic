import { ethers } from "ethers";
import hre from "hardhat";
import fs from 'fs';

async function main() {
  console.log("🚀 Deploying FusionEscrow contract for testing...\n");

  // Create provider and get signers
  const provider = new ethers.JsonRpcProvider("http://localhost:8545");
  const signers = await hre.ethers.getSigners();
  const [deployer, resolver, maker, taker] = signers;
  
  console.log("Accounts:");
  console.log("📝 Deployer:", deployer.address);
  console.log("🔧 Resolver:", resolver.address);
  console.log("👤 Maker:", maker.address);
  console.log("👤 Taker:", taker.address);
  
  // Check balances
  const deployerBalance = await provider.getBalance(deployer.address);
  console.log("\n💰 Deployer balance:", ethers.formatEther(deployerBalance), "ETH");

  // Deploy FusionEscrow contract
  console.log("\n📝 Deploying FusionEscrow...");
  
  const FusionEscrow = await hre.ethers.getContractFactory("FusionEscrow");
  const fusionEscrow = await FusionEscrow.deploy();
  
  await fusionEscrow.waitForDeployment();
  const contractAddress = await fusionEscrow.getAddress();
  
  console.log("✅ FusionEscrow deployed to:", contractAddress);

  // Save deployment info
  const deploymentInfo = {
    network: "hardhat",
    chainId: 31337,
    timestamp: new Date().toISOString(),
    contracts: {
      FusionEscrow: contractAddress
    },
    accounts: {
      deployer: deployer.address,
      resolver: resolver.address,
      maker: maker.address,
      taker: taker.address
    }
  };

  fs.writeFileSync(
    'ethereum/deployed-addresses.json',
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n🎉 Deployment completed!");
  console.log("📄 Addresses saved to ethereum/deployed-addresses.json");
  
  return {
    fusionEscrow,
    deployer,
    resolver,
    maker,
    taker
  };
}

// Only run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("💥 Deployment failed:", error);
      process.exit(1);
    });
}

export { main as deployFusionEscrow }; 