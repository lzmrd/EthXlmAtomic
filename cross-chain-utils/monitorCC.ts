// Monitor both chains for escrow events
class CrossChainMonitor {
    async startMonitoring() {
        // Ethereum events
        this.ethereumProvider.on('EscrowCreated', (event) => {
            this.handleEthereumEscrow(event);
        });

        // Stellar events (polling-based)
        setInterval(() => {
            this.pollStellarEvents();
        }, 5000);
    }

    async pollStellarEvents() {
        // Query Stellar contracts for escrow events
        const events = await this.stellarServer.getContractEvents({
            contractId: STELLAR_ESCROW_CONTRACT_ID,
            type: 'EscrowCreated'
        });

        for (const event of events) {
            await this.handleStellarEscrow(event);
        }
    }
}