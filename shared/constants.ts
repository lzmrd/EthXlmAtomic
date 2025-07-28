// 1inch API Configuration
export const ONEINCH_API = {
  BASE_URL: 'https://api.1inch.dev',
  VERSION: 'v1.0',
  ENDPOINTS: {
    QUOTE: '/fusion-plus/v1.0/1/quote',
    ORDER: '/fusion-plus/v1.0/1/order', 
    ORDER_STATUS: '/fusion-plus/v1.0/1/order',
    AUCTIONS: '/fusion-plus/v1.0/1/auctions/active',
    EXECUTION: '/fusion-plus/v1.0/1/resolver/execution'
  }
};

// Stellar Configuration
export const STELLAR_CONFIG = {
  TESTNET_URL: 'https://horizon-testnet.stellar.org',
  MAINNET_URL: 'https://horizon.stellar.org',
  NETWORK_PASSPHRASE: {
    TESTNET: 'Test SDF Network ; September 2015',
    MAINNET: 'Public Global Stellar Network ; September 2015'
  }
};

// Ethereum Configuration  
export const ETHEREUM_CONFIG = {
  SEPOLIA_RPC: 'https://sepolia.drpc.org',
  MAINNET_RPC: 'https://eth.drpc.org',
  CHAIN_IDS: {
    MAINNET: 1,
    SEPOLIA: 11155111
  }
};

// Contract Addresses (will be populated after deployment)
export const CONTRACT_ADDRESSES = {
  ETHEREUM: {
    ESCROW_FACTORY: '',
    RESOLVER: ''
  },
  STELLAR: {
    ESCROW_CONTRACT: '',
    RESOLVER_CONTRACT: ''
  }
};

// Time Constants
export const TIME_CONSTANTS = {
  DEFAULT_TIMELOCK: 3600, // 1 hour in seconds
  AUCTION_DURATION: 300,  // 5 minutes
  MONITORING_INTERVAL: 5000, // 5 seconds
  SECRET_REVEAL_TIMEOUT: 1800 // 30 minutes
}; 