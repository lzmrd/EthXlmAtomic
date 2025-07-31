// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title FusionEscrow - 1inch Fusion+ compliant escrow contract
 * @dev Implements the full Fusion+ model with safety deposits, timelock phases, and resolver-centric operations
 * @notice Based on 1inch Fusion+ whitepaper: https://docs.1inch.io/docs/fusion+/introduction
 * @notice Simulates Limit Order Protocol pattern with EIP-712 signatures
 */
contract FusionEscrow is EIP712 {
    using ECDSA for bytes32;
    
    // EIP-712 domain separator
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(bytes32 escrowId,address maker,address targetAddress,uint256 amount,address token,bytes32 hashlock,uint256 finalityDuration,uint256 exclusiveDuration,uint256 cancellationDuration,uint256 nonce)"
    );
    
    struct Order {
        bytes32 escrowId;
        address maker;
        address targetAddress;
        uint256 amount;
        address token;
        bytes32 hashlock;
        uint256 finalityDuration;
        uint256 exclusiveDuration;
        uint256 cancellationDuration;
        uint256 nonce;
    }
    
    struct EscrowData {
        address maker;           // Maker address (who owns the tokens being swapped)
        address resolver;        // Resolver address (who creates and manages the escrow)
        address targetAddress;   // Target withdrawal address (where tokens go on claim)
        uint256 amount;          // Amount locked in escrow (maker's tokens)
        uint256 safetyDeposit;   // Safety deposit amount in native token
        address token;           // Token contract address (address(0) for native ETH)
        bytes32 hashlock;        // Hash of the secret required to claim
        uint256 finalityLock;    // Finality lock expiration (timestamp)
        uint256 exclusiveLock;   // Exclusive withdrawal period expiration (for resolver)
        uint256 cancellationLock; // Final cancellation timelock expiration
        bool depositPhase;       // Whether escrow is in deposit phase (finality lock active)
        bool completed;          // Whether escrow is completed (claimed or cancelled)
    }
    
    mapping(bytes32 => EscrowData) public escrows;
    mapping(address => uint256) public makerNonces;
    uint256 public escrowCounter;
    
    // Events for different phases and actions
    event SourceEscrowCreated(bytes32 indexed escrowId, address indexed maker, address indexed resolver, uint256 amount, uint256 safetyDeposit, uint256 finalityLock);
    event DestinationEscrowCreated(bytes32 indexed escrowId, address indexed maker, address indexed resolver, uint256 amount, uint256 safetyDeposit, uint256 finalityLock);
    event EscrowClaimedExclusive(bytes32 indexed escrowId, address indexed resolver, bytes32 secret);
    event EscrowClaimedPublic(bytes32 indexed escrowId, address indexed caller, bytes32 secret);
    event EscrowCancelledExclusive(bytes32 indexed escrowId, address indexed resolver);
    event EscrowCancelledPublic(bytes32 indexed escrowId, address indexed caller);
    
    // Custom errors for gas efficiency
    error EscrowNotFound();
    error EscrowAlreadyExists();
    error EscrowAlreadyCompleted();
    error InvalidSecret();
    error FinalityLockActive();
    error ExclusivePeriodExpired();
    error CancellationNotAllowed();
    error OnlyResolver();
    error InvalidAmount();
    error InsufficientSafetyDeposit();
    error TransferFailed();
    error InvalidSignature();
    error InvalidNonce();

    constructor() EIP712("FusionEscrow", "1.0.0") {}

    /**
     * @dev Get the current nonce for a maker
     */
    function getNonce(address maker) external view returns (uint256) {
        return makerNonces[maker];
    }

    /**
     * @dev Verify EIP-712 signature for an order
     */
    function _verifyOrderSignature(Order memory order, bytes memory signature) internal view returns (bool) {
        bytes32 structHash = keccak256(abi.encode(
            ORDER_TYPEHASH,
            order.escrowId,
            order.maker,
            order.targetAddress,
            order.amount,
            order.token,
            order.hashlock,
            order.finalityDuration,
            order.exclusiveDuration,
            order.cancellationDuration,
            order.nonce
        ));
        
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        
        return signer == order.maker;
    }

    /**
     * @dev Create escrow on source chain using EIP-712 signature (simulating LOP)
     * @notice In Fusion+, Alice signs an order, resolver uses fillOrderArgs pattern
     * @notice Resolver pays only safety deposit, Alice's tokens come via allowance
     * @notice Supports bidirectional swaps: ETH/WETH ↔ XLM
     */
    function createSourceEscrowWithSignature(
        Order memory order,
        bytes memory signature
    ) external payable {
        // Verify signature
        if (!_verifyOrderSignature(order, signature)) revert InvalidSignature();
        
        // Verify nonce
        if (order.nonce != makerNonces[order.maker]) revert InvalidNonce();
        
        // Increment nonce
        makerNonces[order.maker]++;
        
        // Create escrow using order data
        _createSourceEscrow(
            order.escrowId,
            order.maker,
            order.targetAddress,
            order.amount,
            order.token,
            order.hashlock,
            order.finalityDuration,
            order.exclusiveDuration,
            order.cancellationDuration
        );
    }

    /**
     * @dev Create escrow on source chain (resolver deposits Alice's tokens + safety deposit)
     * @notice In Fusion+, Alice approves the escrow contract, resolver uses transferFrom
     * @notice Resolver pays only safety deposit, Alice's tokens come via allowance
     */
    function createSourceEscrow(
        bytes32 escrowId,
        address maker,
        address targetAddress,
        uint256 amount,
        address token,
        bytes32 hashlock,
        uint256 finalityDuration,
        uint256 exclusiveDuration,
        uint256 cancellationDuration
    ) external payable {
        _createSourceEscrow(
            escrowId,
            maker,
            targetAddress,
            amount,
            token,
            hashlock,
            finalityDuration,
            exclusiveDuration,
            cancellationDuration
        );
    }

    /**
     * @dev Internal function to create source escrow
     */
    function _createSourceEscrow(
        bytes32 escrowId,
        address maker,
        address targetAddress,
        uint256 amount,
        address token,
        bytes32 hashlock,
        uint256 finalityDuration,
        uint256 exclusiveDuration,
        uint256 cancellationDuration
    ) internal {
        if (escrows[escrowId].maker != address(0)) revert EscrowAlreadyExists();
        if (amount == 0) revert InvalidAmount();
        
        uint256 safetyDeposit = 0.0001 ether;
        
        if (token == address(0)) {
            // For native ETH: resolver pays for Alice's amount + safety deposit
            // When swap completes, resolver gets Alice's amount + safety deposit back
            if (msg.value < amount + safetyDeposit) revert InsufficientSafetyDeposit();
        } else {
            // For ERC20 tokens: Alice must approve this contract first
            // Resolver pays only safety deposit, uses transferFrom for Alice's tokens
            if (msg.value < safetyDeposit) revert InsufficientSafetyDeposit();
            
            // Transfer Alice's tokens using her allowance
            (bool success, bytes memory data) = token.call(
                abi.encodeWithSignature("transferFrom(address,address,uint256)", maker, address(this), amount)
            );
            if (!success || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        }
        
        // Direct assignment to avoid stack too deep
        escrows[escrowId].maker = maker;
        escrows[escrowId].resolver = msg.sender;
        escrows[escrowId].targetAddress = targetAddress;
        escrows[escrowId].amount = amount;
        escrows[escrowId].safetyDeposit = safetyDeposit;
        escrows[escrowId].token = token;
        escrows[escrowId].hashlock = hashlock;
        escrows[escrowId].finalityLock = block.timestamp + finalityDuration;
        escrows[escrowId].exclusiveLock = block.timestamp + finalityDuration + exclusiveDuration;
        escrows[escrowId].cancellationLock = block.timestamp + finalityDuration + exclusiveDuration + cancellationDuration;
        escrows[escrowId].depositPhase = true;
        escrows[escrowId].completed = false;
        
        escrowCounter++;
        
        emit SourceEscrowCreated(escrowId, maker, msg.sender, amount, safetyDeposit, block.timestamp + finalityDuration);
    }
    
    /**
     * @dev Create escrow on destination chain (resolver deposits own tokens + safety deposit)
     * @notice For bidirectional swaps: if source is ETH, destination is XLM and vice versa
     */
    function createDestinationEscrow(
        bytes32 escrowId,
        address maker,
        uint256 amount,
        address token,
        bytes32 hashlock,
        uint256 finalityDuration,
        uint256 exclusiveDuration,
        uint256 cancellationDuration
    ) external payable {
        if (escrows[escrowId].maker != address(0)) revert EscrowAlreadyExists();
        if (amount == 0) revert InvalidAmount();
        
        uint256 safetyDeposit = 0.0001 ether;
        
        if (token == address(0)) {
            // For native ETH: resolver pays for amount + safety deposit
            if (msg.value < amount + safetyDeposit) revert InsufficientSafetyDeposit();
        } else {
            // For ERC20 tokens (WETH): resolver sends safety deposit and uses allowance
            if (msg.value < safetyDeposit) revert InsufficientSafetyDeposit();
            (bool success, bytes memory data) = token.call(
                abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
            );
            if (!success || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        }
        
        // Direct assignment to avoid stack too deep
        escrows[escrowId].maker = maker;
        escrows[escrowId].resolver = msg.sender;
        escrows[escrowId].targetAddress = maker; // Maker receives on destination chain
        escrows[escrowId].amount = amount;
        escrows[escrowId].safetyDeposit = safetyDeposit;
        escrows[escrowId].token = token;
        escrows[escrowId].hashlock = hashlock;
        escrows[escrowId].finalityLock = block.timestamp + finalityDuration;
        escrows[escrowId].exclusiveLock = block.timestamp + finalityDuration + exclusiveDuration;
        escrows[escrowId].cancellationLock = block.timestamp + finalityDuration + exclusiveDuration + cancellationDuration;
        escrows[escrowId].depositPhase = true;
        escrows[escrowId].completed = false;
        
        emit DestinationEscrowCreated(escrowId, maker, msg.sender, amount, safetyDeposit, block.timestamp + finalityDuration);
    }
    
    /**
     * @dev Claim escrow with secret (during exclusive period - only original resolver)
     */
    function claimExclusive(bytes32 escrowId, bytes32 secret) external {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (msg.sender != escrow.resolver) revert OnlyResolver();
        if (escrow.completed) revert EscrowAlreadyCompleted();
        
        uint256 currentTime = block.timestamp;
        
        // Check if finality lock has expired
        if (currentTime < escrow.finalityLock) revert FinalityLockActive();
        
        // Check if still in exclusive period
        if (currentTime >= escrow.exclusiveLock) revert ExclusivePeriodExpired();
        
        // Verify secret matches hashlock
        if (sha256(abi.encodePacked(secret)) != escrow.hashlock) revert InvalidSecret();
        
        // Transfer tokens to target address
        _transferTokens(escrow.token, escrow.targetAddress, escrow.amount);
        
        // Transfer safety deposit back to resolver
        (bool success, ) = escrow.resolver.call{value: escrow.safetyDeposit}("");
        if (!success) revert TransferFailed();
        
        escrow.completed = true;
        
        emit EscrowClaimedExclusive(escrowId, escrow.resolver, secret);
    }
    
    /**
     * @dev Claim escrow with secret (after exclusive period - any resolver can claim safety deposit)
     */
    function claimPublic(bytes32 escrowId, bytes32 secret) external {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (escrow.completed) revert EscrowAlreadyCompleted();
        
        uint256 currentTime = block.timestamp;
        
        // Check if exclusive period has expired
        if (currentTime < escrow.exclusiveLock) revert FinalityLockActive();
        
        // Check if not yet in cancellation period
        if (currentTime >= escrow.cancellationLock) revert CancellationNotAllowed();
        
        // Verify secret matches hashlock
        if (sha256(abi.encodePacked(secret)) != escrow.hashlock) revert InvalidSecret();
        
        // Transfer tokens to target address
        _transferTokens(escrow.token, escrow.targetAddress, escrow.amount);
        
        // Transfer safety deposit to caller (incentive for any resolver to help)
        (bool success, ) = msg.sender.call{value: escrow.safetyDeposit}("");
        if (!success) revert TransferFailed();
        
        escrow.completed = true;
        
        emit EscrowClaimedPublic(escrowId, msg.sender, secret);
    }
    
    /**
     * @dev Cancel escrow after timelock expires (original resolver gets safety deposit back)
     */
    function cancelExclusive(bytes32 escrowId) external {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (msg.sender != escrow.resolver) revert OnlyResolver();
        if (escrow.completed) revert EscrowAlreadyCompleted();
        
        uint256 currentTime = block.timestamp;
        
        // Check if cancellation period has started
        if (currentTime < escrow.cancellationLock) revert CancellationNotAllowed();
        
        // Return tokens to original owner
        address returnAddress = (escrow.targetAddress == escrow.maker) ? escrow.resolver : escrow.maker;
        _transferTokens(escrow.token, returnAddress, escrow.amount);
        
        // Return safety deposit to resolver
        (bool success, ) = escrow.resolver.call{value: escrow.safetyDeposit}("");
        if (!success) revert TransferFailed();
        
        escrow.completed = true;
        
        emit EscrowCancelledExclusive(escrowId, escrow.resolver);
    }
    
    /**
     * @dev Cancel escrow after timelock expires (any resolver can claim safety deposit as incentive)
     */
    function cancelPublic(bytes32 escrowId) external {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (escrow.completed) revert EscrowAlreadyCompleted();
        
        uint256 currentTime = block.timestamp;
        
        // Check if in public cancellation period
        if (currentTime < escrow.cancellationLock) revert CancellationNotAllowed();
        
        // Additional check: exclusive cancellation period (1 hour after cancellation starts)
        uint256 exclusiveCancelEnd = escrow.cancellationLock + 1 hours;
        
        if (currentTime < exclusiveCancelEnd && msg.sender != escrow.resolver) {
            revert OnlyResolver();
        }
        
        // Return tokens to original owner
        address returnAddress = (escrow.targetAddress == escrow.maker) ? escrow.resolver : escrow.maker;
        _transferTokens(escrow.token, returnAddress, escrow.amount);
        
        // Safety deposit goes to caller (incentive for any resolver to help)
        (bool success, ) = msg.sender.call{value: escrow.safetyDeposit}("");
        if (!success) revert TransferFailed();
        
        escrow.completed = true;
        
        emit EscrowCancelledPublic(escrowId, msg.sender);
    }
    
    /**
     * @dev Get escrow details
     */
    function getEscrow(bytes32 escrowId) external view returns (EscrowData memory) {
        return escrows[escrowId];
    }
    
    /**
     * @dev Get current escrow count
     */
    function getEscrowCount() external view returns (uint256) {
        return escrowCounter;
    }
    
    /**
     * @dev Internal function to transfer tokens (ETH or ERC20)
     */
    function _transferTokens(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            // Native ETH transfer
            (bool success, ) = to.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            // ERC20 token transfer
            (bool success, bytes memory data) = token.call(
                abi.encodeWithSignature("transfer(address,uint256)", to, amount)
            );
            if (!success || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        }
    }
    
    /**
     * @dev Emergency function to recover stuck funds (only if escrow is completed)
     */
    function emergencyWithdraw(bytes32 escrowId) external {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (!escrow.completed) revert();
        
        // Only allow after a very long time (e.g., 30 days) and only to maker
        if (block.timestamp < escrow.cancellationLock + 30 days) revert();
        if (msg.sender != escrow.maker) revert();
        
        // This should only be used in extreme circumstances
        // Transfer any remaining balance to maker
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = escrow.maker.call{value: balance}("");
            if (!success) revert TransferFailed();
        }
    }

    /**
     * @dev Get swap direction based on token addresses
     * @return isEthToXlm True if ETH/WETH → XLM, false if XLM → ETH/WETH
     */
    function getSwapDirection(address sourceToken, address destinationToken) public pure returns (bool isEthToXlm) {
        // If source is ETH/WETH and destination is XLM (represented as address(0) for XLM)
        if ((sourceToken == address(0) || sourceToken == address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2)) && 
            destinationToken == address(0)) {
            return true; // ETH/WETH → XLM
        }
        // If source is XLM and destination is ETH/WETH
        if (sourceToken == address(0) && 
            (destinationToken == address(0) || destinationToken == address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2))) {
            return false; // XLM → ETH/WETH
        }
        revert("Invalid swap direction");
    }

    /**
     * @dev Get WETH address (mainnet)
     */
    function getWETHAddress() public pure returns (address) {
        return address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2); // WETH mainnet
    }

    /**
     * @dev Get WETH address for testnet (Sepolia)
     */
    function getWETHAddressTestnet() public pure returns (address) {
        return address(0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9); // WETH Sepolia
    }
} 