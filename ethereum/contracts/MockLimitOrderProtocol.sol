// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockLimitOrderProtocol
 * @dev Mock implementation of 1inch Limit Order Protocol for testing FusionPlusWrapper
 * @notice This is a simplified mock for demo purposes - implements only essential functions
 */
contract MockLimitOrderProtocol {
    using SafeERC20 for IERC20;

    // Order structure matching 1inch LOP
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

    // State variables
    mapping(bytes32 => uint256) public remaining;
    mapping(bytes32 => bool) public invalidated;
    
    uint256 public orderCounter;

    // Events
    event OrderFilled(
        bytes32 indexed orderHash,
        uint256 makingAmount,
        uint256 takingAmount,
        address indexed maker,
        address indexed taker
    );

    event OrderCancelled(bytes32 indexed orderHash);

    /**
     * @dev Fill an order (simplified mock implementation)
     */
    function fillOrder(
        Order calldata order,
        bytes calldata signature,
        bytes calldata interaction,
        uint256 makingAmount,
        uint256 takingAmount,
        uint256 skipPermitAndThresholdAmount
    ) external payable returns (uint256 actualMakingAmount, uint256 actualTakingAmount, bytes32 orderHash) {
        // Generate order hash
        orderHash = hashOrder(order);
        
        // Check if order is valid
        require(!invalidated[orderHash], "Order invalidated");
        require(remaining[orderHash] >= makingAmount, "Insufficient remaining amount");
        
        // For demo purposes, we'll just emit event and return values
        // In real LOP, this would handle token transfers, validations, etc.
        
        actualMakingAmount = makingAmount;
        actualTakingAmount = takingAmount;
        
        // Update remaining amount
        if (remaining[orderHash] == 0) {
            remaining[orderHash] = order.makingAmount; // Initialize if first fill
        }
        remaining[orderHash] -= actualMakingAmount;
        
        emit OrderFilled(orderHash, actualMakingAmount, actualTakingAmount, order.maker, msg.sender);
        
        return (actualMakingAmount, actualTakingAmount, orderHash);
    }

    /**
     * @dev Generate hash for an order
     */
    function hashOrder(Order calldata order) public pure returns (bytes32) {
        return keccak256(abi.encode(
            order.salt,
            order.makerAsset,
            order.takerAsset,
            order.maker,
            order.receiver,
            order.allowedSender,
            order.makingAmount,
            order.takingAmount,
            order.offsets,
            keccak256(order.interactions)
        ));
    }

    /**
     * @dev Get remaining amount for an order
     */
    function remainingAmount(bytes32 orderHash) external view returns (uint256) {
        return remaining[orderHash];
    }

    /**
     * @dev Invalidate an order
     */
    function invalidateOrder(Order calldata order) external {
        bytes32 orderHash = hashOrder(order);
        require(msg.sender == order.maker, "Only maker can invalidate");
        
        invalidated[orderHash] = true;
        
        emit OrderCancelled(orderHash);
    }

    /**
     * @dev Check if order is valid
     */
    function isValidOrder(Order calldata order) external view returns (bool) {
        bytes32 orderHash = hashOrder(order);
        return !invalidated[orderHash] && remaining[orderHash] > 0;
    }

    /**
     * @dev Demo function to initialize an order's remaining amount
     * @notice This is for testing purposes only
     */
    function initializeOrderForDemo(Order calldata order) external {
        bytes32 orderHash = hashOrder(order);
        if (remaining[orderHash] == 0) {
            remaining[orderHash] = order.makingAmount;
        }
    }

    /**
     * @dev Get order info for demo
     */
    function getOrderInfo(bytes32 orderHash) external view returns (uint256 remainingAmount, bool isInvalidated) {
        return (remaining[orderHash], invalidated[orderHash]);
    }
}
