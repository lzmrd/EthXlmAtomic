// User creates Fusion+ order via 1inch API
const createOrder = async () => {
    const orderData = {
        src: '0x...', // Ethereum token address
        dst: 'stellar:XLM', // Our custom Stellar identifier
        amount: '1000000000000000000', // 1 ETH in wei
        from: userEthereumAddress,
        to: userStellarAddress,
        
        // Fusion+ specific fields
        auction: {
            duration: 300, // 5 minutes
            startRate: '1000000', // Starting exchange rate
            endRate: '950000'   // Minimum acceptable rate
        },
        
        // Atomic swap parameters
        hashlock: sha256(randomSecret),
        timelock: Date.now() + 3600000 // 1 hour
    };

    // POST to 1inch Fusion+ API
    const response = await fetch('https://api.1inch.dev/fusion-plus/v1.0/1/quote', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(orderData)
    });

    const order = await response.json();
    return order;
};