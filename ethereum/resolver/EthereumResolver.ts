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

// Fusion+ compliant ABI for FusionEscrow contract
const FUSION_ESCROW_ABI = [
  {
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'maker', type: 'address' },
      { name: 'targetAddress', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'hashlock', type: 'bytes32' },
      { name: 'finalityDuration', type: 'uint256' },
      { name: 'exclusiveDuration', type: 'uint256' },
      { name: 'cancellationDuration', type: 'uint256' }
    ],
    name: 'createSourceEscrow',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'maker', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'hashlock', type: 'bytes32' },
      { name: 'finalityDuration', type: 'uint256' },
      { name: 'exclusiveDuration', type: 'uint256' },
      { name: 'cancellationDuration', type: 'uint256' }
    ],
    name: 'createDestinationEscrow',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'secret', type: 'bytes32' }
    ],
    name: 'claimExclusive',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'secret', type: 'bytes32' }
    ],
    name: 'claimPublic',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'escrowId', type: 'bytes32' }],
    name: 'cancelExclusive',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'escrowId', type: 'bytes32' }],
    name: 'cancelPublic',
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
          { name: 'resolver', type: 'address' },
          { name: 'targetAddress', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'safetyDeposit', type: 'uint256' },
          { name: 'token', type: 'address' },
          { name: 'hashlock', type: 'bytes32' },
          { name: 'finalityLock', type: 'uint256' },
          { name: 'exclusiveLock', type: 'uint256' },
          { name: 'cancellationLock', type: 'uint256' },
          { name: 'depositPhase', type: 'bool' },
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
    inputs: [],
    name: 'getEscrowCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { indexed: true, name: 'maker', type: 'address' },
      { indexed: true, name: 'resolver', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'safetyDeposit', type: 'uint256' },
      { indexed: false, name: 'finalityLock', type: 'uint256' }
    ],
    name: 'SourceEscrowCreated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { indexed: true, name: 'maker', type: 'address' },
      { indexed: true, name: 'resolver', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'safetyDeposit', type: 'uint256' },
      { indexed: false, name: 'finalityLock', type: 'uint256' }
    ],
    name: 'DestinationEscrowCreated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { indexed: true, name: 'resolver', type: 'address' },
      { indexed: false, name: 'secret', type: 'bytes32' }
    ],
    name: 'EscrowClaimedExclusive',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'escrowId', type: 'bytes32' },
      { indexed: true, name: 'caller', type: 'address' },
      { indexed: false, name: 'secret', type: 'bytes32' }
    ],
    name: 'EscrowClaimedPublic',
    type: 'event'
  }
] as const;

// Fusion+ timelock constants (in seconds)
const FUSION_TIMELOCK_CONFIG = {
  FINALITY_DURATION: 300,      // 5 minutes - time for finality lock
  EXCLUSIVE_DURATION: 1800,    // 30 minutes - exclusive period for resolver
  CANCELLATION_DURATION: 3600, // 1 hour - time until cancellation allowed
  SAFETY_DEPOSIT: parseEther('0.1') // 0.1 ETH safety deposit
};

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
      console.log(`📋 Connected to FusionEscrow contract: ${escrowContractAddress}`);
    } catch (error) {
      console.error('❌ Failed to initialize EthereumResolver:', error);
      throw error;
    }
  }

  /**
   * Create source escrow on Ethereum (resolver deposits maker's tokens + safety deposit)
   * This is called when Ethereum is the SOURCE chain (Alice has ETH, wants other token)
   */
  async createSourceEscrow(orderHash: string, auction: FusionAuction, targetAddress: Address): Promise<Hash> {
    if (!this.walletClient || !this.account || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`📝 Creating Ethereum SOURCE escrow for order: ${orderHash}`);

    try {
      // Convert orderHash to bytes32
      const escrowId = keccak256(toHex(orderHash));
      
      // Parse maker address from auction
      const makerAddress = auction.maker as Address;
      
      // Amount is what the maker is providing (their tokens)
      const amount = parseEther(auction.srcAmount);
      
      // For ETH (native token), token address is 0x0
      const tokenAddress = '0x0000000000000000000000000000000000000000' as Address;

      // Total value = amount + safety deposit
      const totalValue = amount + FUSION_TIMELOCK_CONFIG.SAFETY_DEPOSIT;

      // Create source escrow transaction
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: FUSION_ESCROW_ABI,
        functionName: 'createSourceEscrow',
        args: [
          escrowId,
          makerAddress,
          targetAddress,
          amount,
          tokenAddress,
          auction.hashlock as `0x${string}`,
          BigInt(FUSION_TIMELOCK_CONFIG.FINALITY_DURATION),
          BigInt(FUSION_TIMELOCK_CONFIG.EXCLUSIVE_DURATION),
          BigInt(FUSION_TIMELOCK_CONFIG.CANCELLATION_DURATION)
        ],
        account: this.account,
        value: totalValue,
        gas: 600000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum source escrow transaction sent: ${hash}`);
      
      // Wait for transaction receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum source escrow created in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to create Ethereum source escrow:`, error);
      throw error;
    }
  }

  /**
   * Create destination escrow on Ethereum (resolver deposits own tokens + safety deposit)
   * This is called when Ethereum is the DESTINATION chain (Alice wants ETH, has other token)
   */
  async createDestinationEscrow(orderHash: string, auction: FusionAuction): Promise<Hash> {
    if (!this.walletClient || !this.account || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`📝 Creating Ethereum DESTINATION escrow for order: ${orderHash}`);

    try {
      // Convert orderHash to bytes32
      const escrowId = keccak256(toHex(orderHash));
      
      // Parse maker address
      const makerAddress = auction.maker as Address;
      
      // Amount is what the resolver is providing (destination tokens)
      const amount = parseEther(auction.dstAmount);
      
      // For ETH (native token), token address is 0x0
      const tokenAddress = '0x0000000000000000000000000000000000000000' as Address;

      // Total value = amount + safety deposit
      const totalValue = amount + FUSION_TIMELOCK_CONFIG.SAFETY_DEPOSIT;

      // Create destination escrow transaction
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: FUSION_ESCROW_ABI,
        functionName: 'createDestinationEscrow',
        args: [
          escrowId,
          makerAddress,
          amount,
          tokenAddress,
          auction.hashlock as `0x${string}`,
          BigInt(FUSION_TIMELOCK_CONFIG.FINALITY_DURATION),
          BigInt(FUSION_TIMELOCK_CONFIG.EXCLUSIVE_DURATION),
          BigInt(FUSION_TIMELOCK_CONFIG.CANCELLATION_DURATION)
        ],
        account: this.account,
        value: totalValue,
        gas: 600000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum destination escrow transaction sent: ${hash}`);
      
      // Wait for transaction receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum destination escrow created in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to create Ethereum destination escrow:`, error);
      throw error;
    }
  }

  /**
   * Claim from escrow using secret (during exclusive period)
   */
  async claimEscrowExclusive(orderHash: string, secret: string): Promise<Hash> {
    if (!this.walletClient || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`🔓 Claiming Ethereum escrow exclusively for order: ${orderHash}`);

    try {
      const escrowId = keccak256(toHex(orderHash));
      const secretBytes = keccak256(toHex(secret));

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: FUSION_ESCROW_ABI,
        functionName: 'claimExclusive',
        args: [escrowId, secretBytes],
        account: this.account,
        gas: 400000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum exclusive claim transaction sent: ${hash}`);
      
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum escrow claimed exclusively in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to claim Ethereum escrow exclusively:`, error);
      throw error;
    }
  }

  /**
   * Claim from escrow using secret (after exclusive period, any resolver can claim safety deposit)
   */
  async claimEscrowPublic(orderHash: string, secret: string): Promise<Hash> {
    if (!this.walletClient || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`🔓 Claiming Ethereum escrow publicly for order: ${orderHash}`);

    try {
      const escrowId = keccak256(toHex(orderHash));
      const secretBytes = keccak256(toHex(secret));

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: FUSION_ESCROW_ABI,
        functionName: 'claimPublic',
        args: [escrowId, secretBytes],
        account: this.account,
        gas: 400000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum public claim transaction sent: ${hash}`);
      
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum escrow claimed publicly in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to claim Ethereum escrow publicly:`, error);
      throw error;
    }
  }

  /**
   * Cancel escrow after timelock expires (exclusive period)
   */
  async cancelEscrowExclusive(orderHash: string): Promise<Hash> {
    if (!this.walletClient || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`❌ Cancelling Ethereum escrow exclusively for order: ${orderHash}`);

    try {
      const escrowId = keccak256(toHex(orderHash));

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: FUSION_ESCROW_ABI,
        functionName: 'cancelExclusive',
        args: [escrowId],
        account: this.account,
        gas: 400000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum exclusive cancel transaction sent: ${hash}`);
      
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum escrow cancelled exclusively in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to cancel Ethereum escrow exclusively:`, error);
      throw error;
    }
  }

  /**
   * Cancel escrow after timelock expires (public period, any resolver gets safety deposit)
   */
  async cancelEscrowPublic(orderHash: string): Promise<Hash> {
    if (!this.walletClient || !this.contractAddress) {
      throw new Error('EthereumResolver not initialized');
    }

    console.log(`❌ Cancelling Ethereum escrow publicly for order: ${orderHash}`);

    try {
      const escrowId = keccak256(toHex(orderHash));

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: FUSION_ESCROW_ABI,
        functionName: 'cancelPublic',
        args: [escrowId],
        account: this.account,
        gas: 400000n,
        chain: sepolia
      });

      console.log(`⏳ Ethereum public cancel transaction sent: ${hash}`);
      
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      console.log(`✅ Ethereum escrow cancelled publicly in block ${receipt.blockNumber}`);

      return hash;
    } catch (error) {
      console.error(`❌ Failed to cancel Ethereum escrow publicly:`, error);
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
        abi: FUSION_ESCROW_ABI,
        functionName: 'getEscrow',
        args: [escrowId]
      }) as {
        maker: `0x${string}`;
        resolver: `0x${string}`;
        targetAddress: `0x${string}`;
        amount: bigint;
        safetyDeposit: bigint;
        token: `0x${string}`;
        hashlock: `0x${string}`;
        finalityLock: bigint;
        exclusiveLock: bigint;
        cancellationLock: bigint;
        depositPhase: boolean;
        completed: boolean;
      };

      // Check if escrow exists (maker address is not zero)
      if (escrowData.maker === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      return {
        orderHash,
        contractAddress: this.contractAddress,
        funded: true, // In Fusion+ model, escrows are always funded when created
        amount: formatEther(escrowData.amount),
        hashlock: escrowData.hashlock,
        timelock: Number(escrowData.cancellationLock), // Use cancellation lock as the main timelock
        creator: escrowData.resolver
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

    console.log('👀 Starting Ethereum Fusion+ escrow event monitoring...');

    // Watch for SourceEscrowCreated events
    const unwatchSource = this.publicClient.watchContractEvent({
      address: this.contractAddress,
      abi: FUSION_ESCROW_ABI,
      eventName: 'SourceEscrowCreated',
      onLogs: (logs: any[]) => {
        for (const log of logs) {
          console.log(`📨 New Ethereum source escrow created: ${log.args.escrowId}`);
          
          const escrowData: EscrowData = {
            orderHash: log.args.escrowId as string,
            contractAddress: this.contractAddress!,
            funded: true,
            amount: formatEther(log.args.amount!),
            hashlock: '', // Not available in creation event
            timelock: Number(log.args.finalityLock),
            creator: log.args.resolver as string
          };

          callback(escrowData);
        }
      }
    });

    // Watch for DestinationEscrowCreated events
    const unwatchDestination = this.publicClient.watchContractEvent({
      address: this.contractAddress,
      abi: FUSION_ESCROW_ABI,
      eventName: 'DestinationEscrowCreated',
      onLogs: (logs: any[]) => {
        for (const log of logs) {
          console.log(`📨 New Ethereum destination escrow created: ${log.args.escrowId}`);
          
          const escrowData: EscrowData = {
            orderHash: log.args.escrowId as string,
            contractAddress: this.contractAddress!,
            funded: true,
            amount: formatEther(log.args.amount!),
            hashlock: '', // Not available in creation event
            timelock: Number(log.args.finalityLock),
            creator: log.args.resolver as string
          };

          callback(escrowData);
        }
      }
    });

    return () => {
      unwatchSource();
      unwatchDestination();
    };
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
   * Get current timestamp from latest block
   */
  async getCurrentTimestamp(): Promise<number> {
    const block = await this.publicClient.getBlock();
    return Number(block.timestamp);
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(hash: Hash) {
    return await this.publicClient.getTransactionReceipt({ hash });
  }

  /**
   * Check if we're in exclusive period for an escrow
   */
  async isInExclusivePeriod(orderHash: string): Promise<boolean> {
    const escrowDetails = await this.getEscrowDetails(orderHash);
    if (!escrowDetails) return false;

    const currentTimestamp = await this.getCurrentTimestamp();
    const escrowId = keccak256(toHex(orderHash));
    
    const fullEscrowData = await this.publicClient.readContract({
      address: this.contractAddress!,
      abi: FUSION_ESCROW_ABI,
      functionName: 'getEscrow',
      args: [escrowId]
    }) as any;

    return currentTimestamp >= Number(fullEscrowData.finalityLock) && 
           currentTimestamp < Number(fullEscrowData.exclusiveLock);
  }

  /**
   * Get safety deposit amount
   */
  getSafetyDepositAmount(): string {
    return formatEther(FUSION_TIMELOCK_CONFIG.SAFETY_DEPOSIT);
  }
} 