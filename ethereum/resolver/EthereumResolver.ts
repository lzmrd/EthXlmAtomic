import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseEther, 
  formatEther,
  keccak256, 
  toHex,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { FusionAuction, EscrowData } from '../../shared/types';
import { ETHEREUM_CONFIG } from '../../shared/constants';

// Simple ABI for SimpleEscrow contract with proper typing
const SIMPLE_ESCROW_ABI = [
  {
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'taker', type: 'address' },
      { name: 'hashlock', type: 'bytes32' },
      { name: 'timelock', type: 'uint256' }
    ],
    name: 'createEscrow',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'secret', type: 'bytes32' }
    ],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'escrowId', type: 'bytes32' }],
    name: 'cancel',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'escrowId', type: 'bytes32' }],
    name: 'getEscrow',
    outputs: [
      {
        components: [
          { name: 'maker', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'hashlock', type: 'bytes32' },
          { name: 'timelock', type: 'uint256' },
          { name: 'funded', type: 'bool' },
          { name: 'completed', type: 'bool' }
        ],
        name: '',
        type: 'tuple'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { indexed: false, name: 'maker', type: 'address' },
      { indexed: false, name: 'taker', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'hashlock', type: 'bytes32' },
      { indexed: false, name: 'timelock', type: 'uint256' }
    ],
    name: 'EscrowCreated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { indexed: false, name: 'secret', type: 'bytes32' }
    ],
    name: 'EscrowCompleted',
    type: 'event'
  }
] as const;

export class EthereumResolver {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private account: any = null;
  private contractAddress: Address | null = null;

  constructor(rpcUrl?: string) {
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl || ETHEREUM_CONFIG.SEPOLIA_RPC)
    });
  }

  /**
   * Initialize with private key and contract address
   */
  async initialize(privateKey: `0x${string}`, escrowContractAddress: Address) {
    try {
      // Create account from private key
      this.account = privateKeyToAccount(privateKey);
      
      // Create wallet client
      this.walletClient = createWalletClient({
        account: this.account,
        chain: sepolia,
        transport: http(ETHEREUM_CONFIG.SEPOLIA_RPC)
      });

      this.contractAddress = escrowContractAddress;
      
      console.log(`🔐 Ethereum resolver initialized with wallet: ${this.account.address}`);
      console.log(`📋 Connected to escrow contract: ${escrowContractAddress}`);
    } catch (error) {
      console.error('❌ Failed to initialize EthereumResolver:', error);
      throw error;
    }
  }

  /**
   * Create an escrow on Ethereum (resolver deposits maker's tokens)
   */
  async createEscrow(orderHash: string, auction: FusionAuction): Promise<Hash> {
    if (!this.walletClient || !this.account || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`📝 Creating Ethereum escrow for order: ${orderHash}`);

    try {
      // Convert orderHash to bytes32
      const escrowId = keccak256(toHex(orderHash));
      
      // Calculate timelock (current block timestamp + auction timelock)
      const currentBlock = await this.publicClient.getBlock();
      const timelock = currentBlock.timestamp + BigInt(auction.timelock);

      // Create escrow transaction
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SIMPLE_ESCROW_ABI,
        functionName: 'createEscrow',
        args: [
          escrowId,
          this.account.address, // Resolver is both maker and taker for now (simplified)
          auction.hashlock as `0x${string}`,
          timelock
        ],
        account: this.account,
        value: parseEther(auction.srcAmount),
        gas: 500000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum escrow transaction sent: ${hash}`);
      
      // Wait for transaction receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum escrow created in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to create Ethereum escrow:`, error);
      throw error;
    }
  }

  /**
   * Claim from escrow using secret
   */
  async claimEscrow(orderHash: string, secret: string): Promise<Hash> {
    if (!this.walletClient || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`🔓 Claiming Ethereum escrow for order: ${orderHash}`);

    try {
      const escrowId = keccak256(toHex(orderHash));
      const secretBytes = keccak256(toHex(secret));

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SIMPLE_ESCROW_ABI,
        functionName: 'claim',
        args: [escrowId, secretBytes],
        account: this.account,
        gas: 300000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum claim transaction sent: ${hash}`);
      
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum escrow claimed in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to claim Ethereum escrow:`, error);
      throw error;
    }
  }

  /**
   * Cancel escrow after timelock expires
   */
  async cancelEscrow(orderHash: string): Promise<Hash> {
    if (!this.walletClient || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`❌ Cancelling Ethereum escrow for order: ${orderHash}`);

    try {
      const escrowId = keccak256(toHex(orderHash));

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SIMPLE_ESCROW_ABI,
        functionName: 'cancel',
        args: [escrowId],
        account: this.account,
        gas: 300000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum cancel transaction sent: ${hash}`);
      
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum escrow cancelled in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to cancel Ethereum escrow:`, error);
      throw error;
    }
  }

  /**
   * Get escrow details
   */
  async getEscrowDetails(orderHash: string): Promise<EscrowData | null> {
    if (!this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    try {
      const escrowId = keccak256(toHex(orderHash));

      const escrowData = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: SIMPLE_ESCROW_ABI,
        functionName: 'getEscrow',
        args: [escrowId]
      }) as {
        maker: `0x${string}`;
        taker: `0x${string}`;
        amount: bigint;
        hashlock: `0x${string}`;
        timelock: bigint;
        funded: boolean;
        completed: boolean;
      };

      // Check if escrow exists (maker address is not zero)
      if (escrowData.maker === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      return {
        orderHash,
        contractAddress: this.contractAddress,
        funded: escrowData.funded,
        amount: formatEther(escrowData.amount),
        hashlock: escrowData.hashlock,
        timelock: Number(escrowData.timelock),
        creator: escrowData.maker
      };
    } catch (error) {
      console.error(`❌ Failed to get escrow details:`, error);
      return null;
    }
  }

  /**
   * Monitor escrow events
   */
  async startEventMonitoring(callback: (escrowData: EscrowData) => void) {
    if (!this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log('👀 Starting Ethereum escrow event monitoring...');

         // Watch for EscrowCreated events
     const unwatch = this.publicClient.watchContractEvent({
       address: this.contractAddress,
       abi: SIMPLE_ESCROW_ABI,
       eventName: 'EscrowCreated',
       onLogs: (logs: any[]) => {
        for (const log of logs) {
          console.log(`📨 New Ethereum escrow created: ${log.args.escrowId}`);
          
          const escrowData: EscrowData = {
            orderHash: log.args.escrowId as string,
            contractAddress: this.contractAddress!,
            funded: true,
            amount: formatEther(log.args.amount!),
            hashlock: log.args.hashlock as string,
            timelock: Number(log.args.timelock),
            creator: log.args.maker as string
          };

          callback(escrowData);
        }
      }
    });

    return unwatch;
  }

  /**
   * Get wallet balance
   */
  async getBalance(): Promise<string> {
    if (!this.account) {
      throw new Error('Wallet not initialized');
    }

    const balance = await this.publicClient.getBalance({
      address: this.account.address
    });
    
    return formatEther(balance);
  }

  /**
   * Get contract address
   */
  getContractAddress(): string {
    return this.contractAddress || '';
  }

  /**
   * Get wallet address
   */
  getWalletAddress(): string {
    return this.account?.address || '';
  }

  /**
   * Get current block number
   */
  async getCurrentBlockNumber(): Promise<bigint> {
    return await this.publicClient.getBlockNumber();
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(hash: Hash) {
    return await this.publicClient.getTransactionReceipt({ hash });
  }
} 