//! Fusion+ Intent-based Atomic Swap Escrow Contracts for Stellar
//! Implements 1inch Fusion+ Limit Order Protocol functionality on non-EVM chain
//!
//! This module provides two escrow implementations:
//! 1. Simple escrow for basic atomic swaps
//! 2. Fusion+ escrow for intent-based atomic swaps with Dutch auctions

#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, token, contracterror};

// Re-export the simplified Fusion+ escrow contract (working version)
pub use fusion_simple::*;

// Keep simple escrow for backward compatibility
mod simple_escrow;
pub use simple_escrow::*;

// Include the simplified Fusion+ escrow implementation (working version)
mod fusion_simple;

// Keep comprehensive version for reference (has compilation issues)
mod fusion_escrow;

// Test modules
#[cfg(test)]
mod test;

#[cfg(test)]
mod fusion_test;

#[cfg(test)]
mod fusion_simple_test;

#[cfg(test)]
mod fusion_minimal_test;

#[cfg(test)]
mod fusion_basic_test;

#[cfg(test)]
mod fusion_onchain_test;
