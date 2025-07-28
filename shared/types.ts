// Fusion+ Order Types
export interface SwapParams {
  fromToken: string;
  toToken: string;
  amount: string;
  fromAddress: string;
  toAddress: string;
  timelock: number;
  hashlock?: string;
}

export interface SignedOrder {
  orderHash: string;
  signature: string;
  maker: string;
  taker: string;
  hashlock: string;
  timelock: number;
  srcToken: string;
  dstToken: string;
  amount: string;
}

export interface ExecutionReport {
  orderId: string;
  ethereumTxHash: string;
  stellarTxHash: string;
  resolverAddress: string;
  status: 'completed' | 'failed';
}

export interface FusionAuction {
  id: string;
  orderHash: string;
  hashlock: string;
  timelock: number;
  srcChain: string;
  dstChain: string;
  srcToken: string;
  dstToken: string;
  srcAmount: string;
  dstAmount: string;
  stellarAmount: string;
  currentRate: string;
  startTime: number;
  endTime: number;
}

export interface FusionOrder {
  hash: string;
  maker: string;
  taker: string;
  srcChain: string;
  dstChain: string;
  srcToken: string;
  dstToken: string;
  amount: string;
  hashlock: string;
  timelock: number;
  status: 'active' | 'completed' | 'cancelled';
}

export interface EscrowData {
  orderHash: string;
  contractAddress: string;
  funded: boolean;
  amount: string;
  hashlock: string;
  timelock: number;
  creator: string;
} 