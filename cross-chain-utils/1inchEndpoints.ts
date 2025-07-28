// Key 1inch API endpoints for our integration
const API_ENDPOINTS = {
    // Create/get quotes for cross-chain swaps
    quote: 'https://api.1inch.dev/fusion-plus/v1.0/{chainId}/quote',
    
    // Submit signed orders
    order: 'https://api.1inch.dev/fusion-plus/v1.0/{chainId}/order',
    
    // Get order status and details
    orderStatus: 'https://api.1inch.dev/fusion-plus/v1.0/{chainId}/order/{orderHash}',
    
    // Get active auctions for resolvers
    auctions: 'https://api.1inch.dev/fusion-plus/v1.0/{chainId}/auctions/active',
    
    // Report order execution (resolver)
    reportExecution: 'https://api.1inch.dev/fusion-plus/v1.0/{chainId}/resolver/execution'
};