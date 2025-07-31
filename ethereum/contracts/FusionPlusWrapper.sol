// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// 1inch LOP contract interface (simplified for our needs)
interface ILimitOrderProtocol {
        struct Order {
            uint256 salt;
            address makerAsset;
            address takerAsset;
            address maker;
            address receiver;
            address allowedSender;
            uint256 makingAmount;
            uint256 takingAmount;
            uint256 offsets;
            bytes interactions;
        }

        function fillOrder(
            Order calldata order,
            bytes calldata signature,
            bytes calldata interaction,
            uint256 makingAmount,
            uint256 takingAmount,
            uint256 skipPermitAndThresholdAmount
        ) external payable returns (uint256 actualMakingAmount, uint256 actualTakingAmount, bytes32 orderHash);

        function hashOrder(Order calldata order) external view returns (bytes32);
        function remaining(bytes32 orderHash) external view returns (uint256);
        function invalidateOrder(Order calldata order) external;
    }

/**
 * @title FusionPlusWrapper - Integrates 1inch Limit Order Protocol with atomic cross-chain escrows
 * @dev Wrapper contract that combines:
 *      - 1inch LOP for order matching and Dutch auctions
 *      - Hashlock/timelock escrow functionality for cross-chain atomic swaps
 *      - Safety deposits and resolver incentives from Fusion+ model
 * @notice Supports bidirectional swaps: Ethereum ↔ Stellar (XLM)
 */
contract FusionPlusWrapper is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // Fusion+ specific order structure
    struct FusionOrder {
        bytes32 escrowId;           // Unique escrow identifier
        address maker;              // User initiating the swap
        address targetAddress;      // Where tokens should go on destination chain
        uint256 amount;             // Amount to swap
        address sourceToken;        // Token on source chain (address(0) for ETH)
        address destinationToken;   // Token on destination chain
        bytes32 hashlock;          // Hash of the secret
        uint256 finalityDuration;  // Finality lock duration in seconds
        uint256 exclusiveDuration; // Exclusive period duration in seconds
        uint256 cancellationDuration; // Cancellation period duration in seconds
        uint256 nonce;             // Replay protection
        uint256 deadline;          // Order expiration
        string sourceChain;        // e.g., "ethereum"
        string destinationChain;   // e.g., "stellar"
    }

    struct EscrowData {
        address maker;
        address resolver;
        address targetAddress;
        uint256 amount;
        uint256 safetyDeposit;
        address token;
        bytes32 hashlock;
        uint256 finalityLock;
        uint256 exclusiveLock;
        uint256 cancellationLock;
        bool isSourceChain;        // true if this is source chain escrow
        bool completed;
        bytes32 lopOrderHash;      // Link to LOP order hash
    }

    // EIP-712 type hash for Fusion orders
    bytes32 public constant FUSION_ORDER_TYPEHASH = keccak256(
        "FusionOrder(bytes32 escrowId,address maker,address targetAddress,uint256 amount,address sourceToken,address destinationToken,bytes32 hashlock,uint256 finalityDuration,uint256 exclusiveDuration,uint256 cancellationDuration,uint256 nonce,uint256 deadline,string sourceChain,string destinationChain)"
    );

    // State variables
    ILimitOrderProtocol public immutable limitOrderProtocol;
    address public immutable weth;

    mapping(bytes32 => EscrowData) public escrows;
    mapping(address => uint256) public makerNonces;
    mapping(bytes32 => FusionOrder) public fusionOrders; // Store original orders

    uint256 public constant MIN_SAFETY_DEPOSIT = 0.001 ether;
    uint256 public escrowCounter;

    // Events
    event FusionOrderCreated(
        bytes32 indexed escrowId,
        address indexed maker,
        string sourceChain,
        string destinationChain,
        uint256 amount,
        bytes32 lopOrderHash
    );
    
    event EscrowCreatedViaLOP(
        bytes32 indexed escrowId,
        address indexed maker,
        address indexed resolver,
        uint256 amount,
        bool isSourceChain,
        bytes32 lopOrderHash
    );

    event SecretRevealed(bytes32 indexed escrowId, bytes32 secret, address indexed revealer);
    event EscrowCompleted(bytes32 indexed escrowId, address indexed completer, bool wasClaimed);

    // Custom errors
    error InvalidLOPAddress();
    error InvalidWETHAddress();
    error EscrowNotFound();
    error EscrowAlreadyExists();
    error EscrowAlreadyCompleted();
    error InvalidSecret();
    error FinalityLockActive();
    error ExclusivePeriodExpired();
    error CancellationNotAllowed();
    error OnlyResolver();
    error InvalidSignature();
    error InvalidNonce();
    error InsufficientSafetyDeposit();
    error TransferFailed();
    error OrderExpired();
    error UnsupportedChain();

    constructor(
        address _limitOrderProtocol,
        address _weth
    ) EIP712("FusionPlusWrapper", "1.0.0") {
        if (_limitOrderProtocol == address(0)) revert InvalidLOPAddress();
        if (_weth == address(0)) revert InvalidWETHAddress();
        
        limitOrderProtocol = ILimitOrderProtocol(_limitOrderProtocol);
        weth = _weth;
    }

    /**
     * @dev Create a Fusion+ order that will be filled via LOP
     * @notice Alice signs this order off-chain, resolver calls fillFusionOrder
     */
    function createFusionOrder(
        FusionOrder calldata order,
        bytes calldata signature
    ) external {
        // Verify signature
        if (!_verifyFusionOrderSignature(order, signature)) revert InvalidSignature();
        
        // Verify nonce
        if (order.nonce != makerNonces[order.maker]) revert InvalidNonce();
        
        // Check deadline
        if (block.timestamp > order.deadline) revert OrderExpired();
        
        // Validate chains
        if (!_isValidChainPair(order.sourceChain, order.destinationChain)) revert UnsupportedChain();
        
        // Check if escrow already exists
        if (escrows[order.escrowId].maker != address(0)) revert EscrowAlreadyExists();
        
        // Store the fusion order
        fusionOrders[order.escrowId] = order;
        
        // Increment nonce
        makerNonces[order.maker]++;
        
        // Create corresponding LOP order
        bytes32 lopOrderHash = _createLOPOrder(order);
        
        emit FusionOrderCreated(
            order.escrowId,
            order.maker,
            order.sourceChain,
            order.destinationChain,
            order.amount,
            lopOrderHash
        );
    }

    /**
     * @dev Resolver fills the fusion order by creating escrows and using LOP
     * @notice This combines LOP filling with escrow creation
     */
    function fillFusionOrder(
        bytes32 escrowId,
        uint256 safetyDeposit,
        bytes calldata lopSignature,
        bytes calldata lopInteraction
    ) external payable nonReentrant {
        FusionOrder storage order = fusionOrders[escrowId];
        if (order.maker == address(0)) revert EscrowNotFound();
        
        // Check if this is source or destination chain based on tokens
        bool isSourceChain = _isSourceChain(order.sourceChain, order.sourceToken);
        
        if (isSourceChain) {
            _createSourceEscrowWithLOP(escrowId, order, safetyDeposit, lopSignature, lopInteraction);
        } else {
            _createDestinationEscrowWithLOP(escrowId, order, safetyDeposit);
        }
    }

    /**
     * @dev Create source chain escrow using LOP to fill the order
     */
    function _createSourceEscrowWithLOP(
        bytes32 escrowId,
        FusionOrder storage order,
        uint256 safetyDeposit,
        bytes calldata lopSignature,
        bytes calldata lopInteraction
    ) internal {
        if (safetyDeposit < MIN_SAFETY_DEPOSIT) revert InsufficientSafetyDeposit();
        
        // Create LOP order structure
        ILimitOrderProtocol.Order memory lopOrder = ILimitOrderProtocol.Order({
            salt: uint256(escrowId),
            makerAsset: order.sourceToken,
            takerAsset: order.destinationToken,
            maker: order.maker,
            receiver: address(this), // Escrow contract receives the tokens
            allowedSender: msg.sender, // Only this resolver can fill
            makingAmount: order.amount,
            takingAmount: order.amount, // 1:1 for simplicity, could be calculated
            offsets: 0,
            interactions: ""
        });
        
        // Fill the LOP order
        (uint256 actualMakingAmount, uint256 actualTakingAmount, bytes32 lopOrderHash) = 
            limitOrderProtocol.fillOrder(
                lopOrder,
                lopSignature,
                lopInteraction,
                order.amount,
                order.amount,
                0
            );

        // Create escrow with filled amounts
        _createEscrowData(
            escrowId,
            order,
            actualMakingAmount,
            safetyDeposit,
            true, // isSourceChain
            lopOrderHash
        );

        emit EscrowCreatedViaLOP(escrowId, order.maker, msg.sender, actualMakingAmount, true, lopOrderHash);
    }

    /**
     * @dev Create destination chain escrow (resolver provides tokens directly)
     */
    function _createDestinationEscrowWithLOP(
        bytes32 escrowId,
        FusionOrder storage order,
        uint256 safetyDeposit
    ) internal {
        if (safetyDeposit < MIN_SAFETY_DEPOSIT) revert InsufficientSafetyDeposit();
        
        // On destination chain, resolver provides their own tokens
        if (order.destinationToken == address(0)) {
            // Native ETH
            if (msg.value < order.amount + safetyDeposit) revert InsufficientSafetyDeposit();
        } else {
            // ERC20 token
            if (msg.value < safetyDeposit) revert InsufficientSafetyDeposit();
            IERC20(order.destinationToken).safeTransferFrom(msg.sender, address(this), order.amount);
        }

        _createEscrowData(
            escrowId,
            order,
            order.amount,
            safetyDeposit,
            false, // isSourceChain
            bytes32(0) // No LOP order on destination
        );

        emit EscrowCreatedViaLOP(escrowId, order.maker, msg.sender, order.amount, false, bytes32(0));
    }

    /**
     * @dev Internal function to create escrow data structure
     */
    function _createEscrowData(
        bytes32 escrowId,
        FusionOrder storage order,
        uint256 actualAmount,
        uint256 safetyDeposit,
        bool isSourceChain,
        bytes32 lopOrderHash
    ) internal {
        address tokenAddress = isSourceChain ? order.sourceToken : order.destinationToken;
        
        escrows[escrowId] = EscrowData({
            maker: order.maker,
            resolver: msg.sender,
            targetAddress: isSourceChain ? order.targetAddress : order.maker,
            amount: actualAmount,
            safetyDeposit: safetyDeposit,
            token: tokenAddress,
            hashlock: order.hashlock,
            finalityLock: block.timestamp + order.finalityDuration,
            exclusiveLock: block.timestamp + order.finalityDuration + order.exclusiveDuration,
            cancellationLock: block.timestamp + order.finalityDuration + order.exclusiveDuration + order.cancellationDuration,
            isSourceChain: isSourceChain,
            completed: false,
            lopOrderHash: lopOrderHash
        });

        escrowCounter++;
    }

    /**
     * @dev Claim escrow with secret (exclusive period)
     */
    function claimExclusive(bytes32 escrowId, bytes32 secret) external nonReentrant {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (msg.sender != escrow.resolver) revert OnlyResolver();
        if (escrow.completed) revert EscrowAlreadyCompleted();
        
        uint256 currentTime = block.timestamp;
        if (currentTime < escrow.finalityLock) revert FinalityLockActive();
        if (currentTime >= escrow.exclusiveLock) revert ExclusivePeriodExpired();
        
        // Verify secret
        if (sha256(abi.encodePacked(secret)) != escrow.hashlock) revert InvalidSecret();
        
        _completeClaim(escrowId, secret, escrow.resolver);
    }

    /**
     * @dev Claim escrow with secret (public period)
     */
    function claimPublic(bytes32 escrowId, bytes32 secret) external nonReentrant {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (escrow.completed) revert EscrowAlreadyCompleted();
        
        uint256 currentTime = block.timestamp;
        if (currentTime < escrow.exclusiveLock) revert FinalityLockActive();
        if (currentTime >= escrow.cancellationLock) revert CancellationNotAllowed();
        
        // Verify secret
        if (sha256(abi.encodePacked(secret)) != escrow.hashlock) revert InvalidSecret();
        
        _completeClaim(escrowId, secret, msg.sender);
    }

    /**
     * @dev Internal function to complete claim
     */
    function _completeClaim(bytes32 escrowId, bytes32 secret, address safetyDepositReceiver) internal {
        EscrowData storage escrow = escrows[escrowId];
        
        // Transfer tokens to target
        if (escrow.token == address(0)) {
            (bool success, ) = escrow.targetAddress.call{value: escrow.amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(escrow.token).safeTransfer(escrow.targetAddress, escrow.amount);
        }
        
        // Transfer safety deposit
        (bool success, ) = safetyDepositReceiver.call{value: escrow.safetyDeposit}("");
        if (!success) revert TransferFailed();
        
        escrow.completed = true;
        
        emit SecretRevealed(escrowId, secret, msg.sender);
        emit EscrowCompleted(escrowId, msg.sender, true);
    }

    /**
     * @dev Cancel escrow after timeout
     */
    function cancel(bytes32 escrowId) external nonReentrant {
        EscrowData storage escrow = escrows[escrowId];
        
        if (escrow.maker == address(0)) revert EscrowNotFound();
        if (escrow.completed) revert EscrowAlreadyCompleted();
        
        uint256 currentTime = block.timestamp;
        if (currentTime < escrow.cancellationLock) revert CancellationNotAllowed();
        
        // Return tokens to appropriate party
        address returnAddress = escrow.isSourceChain ? escrow.maker : escrow.resolver;
        
        if (escrow.token == address(0)) {
            (bool success, ) = returnAddress.call{value: escrow.amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(escrow.token).safeTransfer(returnAddress, escrow.amount);
        }
        
        // Safety deposit to caller as incentive
        (bool success, ) = msg.sender.call{value: escrow.safetyDeposit}("");
        if (!success) revert TransferFailed();
        
        escrow.completed = true;
        
        emit EscrowCompleted(escrowId, msg.sender, false);
    }

    // Helper functions
    function _verifyFusionOrderSignature(FusionOrder calldata order, bytes calldata signature) internal view returns (bool) {
        bytes32 structHash = keccak256(abi.encode(
            FUSION_ORDER_TYPEHASH,
            order.escrowId,
            order.maker,
            order.targetAddress,
            order.amount,
            order.sourceToken,
            order.destinationToken,
            order.hashlock,
            order.finalityDuration,
            order.exclusiveDuration,
            order.cancellationDuration,
            order.nonce,
            order.deadline,
            keccak256(bytes(order.sourceChain)),
            keccak256(bytes(order.destinationChain))
        ));
        
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        return signer == order.maker;
    }

    function _createLOPOrder(FusionOrder calldata order) internal pure returns (bytes32) {
        // This would create a proper LOP order hash
        // For now, return a mock hash
        return keccak256(abi.encode(order.escrowId, order.amount, order.maker));
    }

    function _isValidChainPair(string memory sourceChain, string memory destinationChain) internal pure returns (bool) {
        bytes32 ethereum = keccak256(bytes("ethereum"));
        bytes32 stellar = keccak256(bytes("stellar"));
        bytes32 source = keccak256(bytes(sourceChain));
        bytes32 dest = keccak256(bytes(destinationChain));
        
        return (source == ethereum && dest == stellar) || (source == stellar && dest == ethereum);
    }

    function _isSourceChain(string memory chainName, address token) internal view returns (bool) {
        bytes32 ethereum = keccak256(bytes("ethereum"));
        bytes32 chain = keccak256(bytes(chainName));
        
        // If we're on Ethereum and the chain is Ethereum, this is source
        return chain == ethereum;
    }

    // View functions
    function getEscrow(bytes32 escrowId) external view returns (EscrowData memory) {
        return escrows[escrowId];
    }

    function getFusionOrder(bytes32 escrowId) external view returns (FusionOrder memory) {
        return fusionOrders[escrowId];
    }

    function getNonce(address maker) external view returns (uint256) {
        return makerNonces[maker];
    }

    function getEscrowCount() external view returns (uint256) {
        return escrowCounter;
    }

    // Emergency functions
    receive() external payable {}

    function emergencyWithdraw(address token, address to, uint256 amount) external {
        // Only for emergency situations - should be protected by governance
        require(msg.sender == address(this), "Only governance");
        
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "Transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}