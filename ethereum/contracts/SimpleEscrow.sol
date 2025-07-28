// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/**
 * @title SimpleEscrow - A simplified escrow contract for Fusion+ testing
 * @dev This is a minimal implementation for hackathon purposes
 */
contract SimpleEscrow {
    struct EscrowData {
        address maker;
        address taker;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool funded;
        bool completed;
    }
    
    mapping(bytes32 => EscrowData) public escrows;
    
    event EscrowCreated(bytes32 indexed escrowId, address maker, address taker, uint256 amount, bytes32 hashlock, uint256 timelock);
    event EscrowFunded(bytes32 indexed escrowId);
    event EscrowCompleted(bytes32 indexed escrowId, bytes32 secret);
    event EscrowCancelled(bytes32 indexed escrowId);
    
    error EscrowNotFound();
    error EscrowAlreadyFunded();
    error EscrowNotFunded();
    error InvalidSecret();
    error TimelockNotExpired();
    error TimelockExpired();
    error InsufficientValue();
    
    /**
     * @dev Create a new escrow
     */
    function createEscrow(
        bytes32 escrowId,
        address taker,
        bytes32 hashlock,
        uint256 timelock
    ) external payable {
        require(escrows[escrowId].maker == address(0), "Escrow already exists");
        require(msg.value > 0, "Must send ETH");
        
        escrows[escrowId] = EscrowData({
            maker: msg.sender,
            taker: taker,
            amount: msg.value,
            hashlock: hashlock,
            timelock: timelock,
            funded: true,
            completed: false
        });
        
        emit EscrowCreated(escrowId, msg.sender, taker, msg.value, hashlock, timelock);
        emit EscrowFunded(escrowId);
    }
    
    /**
     * @dev Claim escrow with secret
     */
    function claim(bytes32 escrowId, bytes32 secret) external {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (!escrow.funded) revert EscrowNotFunded();
        if (escrow.completed) revert();
        if (block.timestamp > escrow.timelock) revert TimelockExpired();
        if (sha256(abi.encodePacked(secret)) != escrow.hashlock) revert InvalidSecret();
        
        escrow.completed = true;
        
        (bool success, ) = escrow.taker.call{value: escrow.amount}("");
        require(success, "Transfer failed");
        
        emit EscrowCompleted(escrowId, secret);
    }
    
    /**
     * @dev Cancel escrow after timelock expires
     */
    function cancel(bytes32 escrowId) external {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (!escrow.funded) revert EscrowNotFunded();
        if (escrow.completed) revert();
        if (block.timestamp <= escrow.timelock) revert TimelockNotExpired();
        
        escrow.completed = true;
        
        (bool success, ) = escrow.maker.call{value: escrow.amount}("");
        require(success, "Transfer failed");
        
        emit EscrowCancelled(escrowId);
    }
    
    /**
     * @dev Get escrow details
     */
    function getEscrow(bytes32 escrowId) external view returns (EscrowData memory) {
        return escrows[escrowId];
    }
} 