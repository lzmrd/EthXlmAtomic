//! Simplified Fusion+ Escrow Contract for Soroban with Safety Deposit
//! Implements core atomic swap escrow logic for Stellar (non-EVM)

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, token, contracterror,
};

/// Storage TTL (in ledgers)
const STORAGE_TTL: u32 = 8640;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Escrow(BytesN<32>), // escrow_id -> data
    Nonce(Address),      // maker -> last nonce
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct Escrow {
    maker: Address,
    resolver: Address,
    token: Option<Address>, // None = XLM
    amount: i128,
    safety_deposit: i128,
    hashlock: BytesN<32>,
    expiry: u64,            // final time to reveal or exclusive period end
    claimed: bool,
}

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Error {
    Unauthorized = 1,
    AlreadyExists = 2,
    NotFound = 3,
    AlreadyClaimed = 4,
    Expired = 5,
    InvalidSecret = 6,
    InvalidNonce = 7,
    InsufficientDeposit = 8,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Resolver creates escrow with maker's funds and posts safety deposit
    pub fn create(
        env: Env,
        resolver: Address,
        escrow_id: BytesN<32>,
        maker: Address,
        token: Option<Address>,
        amount: i128,
        safety_deposit: i128,
        hashlock: BytesN<32>,
        expiry: u64,
        nonce: u64,
    ) -> Result<(), Error> {
        // Resolver authorization (panics if unauthorized)
        resolver.require_auth();
        
        // Nonce replay protection
        let key_n = DataKey::Nonce(maker.clone());
        let last: u64 = env.storage().persistent().get(&key_n).unwrap_or(0u64);
        if nonce <= last { return Err(Error::InvalidNonce); }
        env.storage().persistent().set(&key_n, &nonce);
        env.storage().persistent().extend_ttl(&key_n, STORAGE_TTL, STORAGE_TTL);
 
        // Unique escrow check
        let key = DataKey::Escrow(escrow_id.clone());
        if env.storage().persistent().has(&key) { return Err(Error::AlreadyExists); }
 
        // Validate deposit amounts
        if amount <= 0 || safety_deposit <= 0 { return Err(Error::InsufficientDeposit); }
 
        // Transfer maker's tokens to contract (only for non-native tokens)
        if let Some(tok) = &token {
            token::Client::new(&env, tok).transfer(&maker, &env.current_contract_address(), &amount);
        }
        // Transfer resolver's safety deposit (only for non-native tokens)
        if let Some(tok) = &token {
            token::Client::new(&env, tok).transfer(&resolver, &env.current_contract_address(), &safety_deposit);
        }
        // For native XLM, the resolver must send XLM via Payment operation in the transaction
 
        // Store escrow record
        let escrow = Escrow { maker: maker.clone(), resolver: resolver.clone(), token: token.clone(), amount, safety_deposit, hashlock: hashlock.clone(), expiry, claimed: false };
        env.storage().persistent().set(&key, &escrow);
        env.storage().persistent().extend_ttl(&key, STORAGE_TTL, STORAGE_TTL);
        Ok(())
    }

    /// Resolver claims escrow by revealing secret before expiry
    pub fn claim(
        env: Env,
        escrow_id: BytesN<32>,
        secret: BytesN<32>,
    ) -> Result<(), Error> {
        let key = DataKey::Escrow(escrow_id.clone());
        let mut escrow: Escrow = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
 
        // Only resolver authorized
        escrow.resolver.require_auth();
        if escrow.claimed { return Err(Error::AlreadyClaimed); }
 
        let now = env.ledger().sequence() as u64;
        if now > escrow.expiry { return Err(Error::Expired); }
 
        // Verify hashlock
        let calc = env.crypto().sha256(&secret.into());
        if calc.to_array() != escrow.hashlock.to_array() { return Err(Error::InvalidSecret); }
 
        // Transfer principal amount to maker
        if let Some(tok) = &escrow.token {
            token::Client::new(&env, tok).transfer(&env.current_contract_address(), &escrow.maker, &escrow.amount);
        }
        // Return safety deposit to resolver
        if let Some(tok) = &escrow.token {
            token::Client::new(&env, tok).transfer(&env.current_contract_address(), &escrow.resolver, &escrow.safety_deposit);
        }
 
        escrow.claimed = true;
        env.storage().persistent().set(&key, &escrow);
        Ok(())
    }

    /// Maker cancels and retrieves funds after expiry
    pub fn cancel(
        env: Env,
        escrow_id: BytesN<32>,
    ) -> Result<(), Error> {
        let key = DataKey::Escrow(escrow_id.clone());
        let mut escrow: Escrow = env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
 
        // Only maker authorized
        escrow.maker.require_auth();
        
        let now = env.ledger().sequence() as u64;
        if now <= escrow.expiry { return Err(Error::Expired); }
 
        // Return principal to maker
        if let Some(tok) = &escrow.token {
            token::Client::new(&env, tok).transfer(&env.current_contract_address(), &escrow.maker, &escrow.amount);
        }
        // Return safety deposit to resolver
        if let Some(tok) = &escrow.token {
            token::Client::new(&env, tok).transfer(&env.current_contract_address(), &escrow.resolver, &escrow.safety_deposit);
        }
 
        escrow.claimed = true;
        env.storage().persistent().set(&key, &escrow);
        Ok(())
    }

    /// Query escrow details
    pub fn get(env: Env, escrow_id: BytesN<32>) -> Option<Escrow> {
        env.storage().persistent().get(&DataKey::Escrow(escrow_id))
    }
}
