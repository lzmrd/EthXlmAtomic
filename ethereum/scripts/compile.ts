// @ts-ignore - solc doesn't have types
import solc from 'solc';
import fs from 'fs';
import path from 'path';

console.log('🔧 Compiling SimpleEscrow.sol...\n');

// Read the contract source code
const contractPath = path.join(__dirname, '../contracts/SimpleEscrow.sol');
const contractSource = fs.readFileSync(contractPath, 'utf8');

// Prepare input for Solidity compiler
const input = {
  language: 'Solidity',
  sources: {
    'SimpleEscrow.sol': {
      content: contractSource
    }
  },
  settings: {
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object']
      }
    },
    optimizer: {
      enabled: true,
      runs: 200
    }
  }
};

try {
  console.log('⚡ Running Solidity compiler...');
  
  // Compile the contract
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  
  // Check for compilation errors
  if (output.errors) {
    const hasErrors = output.errors.some((error: any) => error.severity === 'error');
    
    if (hasErrors) {
      console.error('❌ Compilation errors:');
      output.errors.forEach((error: any) => {
        if (error.severity === 'error') {
          console.error(`   ${error.formattedMessage}`);
        }
      });
      process.exit(1);
    } else {
      console.log('⚠️  Compilation warnings:');
      output.errors.forEach((error: any) => {
        console.log(`   ${error.formattedMessage}`);
      });
    }
  }
  
  // Extract compiled contract
  const contractName = 'SimpleEscrow';
  const contract = output.contracts['SimpleEscrow.sol'][contractName];
  
  if (!contract) {
    console.error('❌ Contract not found in compilation output');
    process.exit(1);
  }
  
  // Extract ABI and bytecode
  const abi = contract.abi;
  const bytecode = '0x' + contract.evm.bytecode.object;
  
  console.log('✅ Compilation successful!');
  console.log(`📋 Contract: ${contractName}`);
  console.log(`🔗 Bytecode length: ${bytecode.length} characters`);
  console.log(`📄 ABI functions: ${abi.filter((item: any) => item.type === 'function').length}`);
  
  // Save compilation artifacts
  const artifactsDir = path.join(__dirname, '../artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }
  
  const artifact = {
    contractName,
    abi,
    bytecode,
    compiler: {
      version: '0.8.23',
      settings: input.settings
    },
    compiledAt: new Date().toISOString()
  };
  
  const artifactPath = path.join(artifactsDir, `${contractName}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  
  console.log(`📦 Artifact saved to: ${artifactPath}`);
  console.log('\n🎉 Ready for deployment!');
  console.log('💡 Next step: npm run deploy:ethereum');
  
  // Also update the deploy script with the real bytecode
  console.log('\n🔄 Updating deploy script with compiled bytecode...');
  
  const deployScriptPath = path.join(__dirname, 'deploy.ts');
  let deployScript = fs.readFileSync(deployScriptPath, 'utf8');
  
  // Replace placeholder bytecode
  deployScript = deployScript.replace(
    /const SIMPLE_ESCROW_BYTECODE = ['"`]0x[^'"`]*['"`];/,
    `const SIMPLE_ESCROW_BYTECODE = '${bytecode}';`
  );
  
  // Replace placeholder ABI import
  deployScript = deployScript.replace(
    /\/\/ SimpleEscrow bytecode.*$/m,
    `// SimpleEscrow bytecode and ABI - compiled ${new Date().toLocaleString()}`
  );
  
  fs.writeFileSync(deployScriptPath, deployScript);
  console.log('✅ Deploy script updated with compiled bytecode');
  
} catch (error) {
  console.error('💥 Compilation failed:', error);
  process.exit(1);
} 