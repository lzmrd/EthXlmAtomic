#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, symbol_short,
    contracterror, Bytes,
};

/// Default storage TTL (30 days in ledgers, ~5 minutes per ledger)
const DEFAULT_TTL: u32 = 8640;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowData {
    /// Maker address (who owns the tokens being swapped)
    pub maker: Address,
    /// Resolver address (who creates and manages the escrow)
    pub resolver: Address,
    /// Target withdrawal address (where tokens go on claim)
    pub target_address: Address,
    /// Amount locked in escrow (maker's tokens)
    pub amount: i128,
    /// Safety deposit amount in native token
    pub safety_deposit: i128,
    /// Token contract address (for Stellar Asset Contract tokens)
    /// Use native token if this is None
    pub token: Option<Address>,
    /// Hash of the secret required to claim
    pub hashlock: BytesN<32>,
    /// Finality lock expiration (ledger sequence)
    pub finality_lock: u64,
    /// Exclusive withdrawal period expiration (for resolver)
    pub exclusive_lock: u64,
    /// Final cancellation timelock expiration
    pub cancellation_lock: u64,
    /// Whether escrow is in deposit phase (finality lock active)
    pub deposit_phase: bool,
    /// Whether escrow is completed (claimed or cancelled)
    pub completed: bool,
}

#[contracttype]
pub enum DataKey {
    Escrow(BytesN<32>), // escrow_id -> EscrowData
    Counter,            // global escrow counter
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    /// Escrow not found
    NotFound = 1,
    /// Escrow already exists
    AlreadyExists = 2,
    /// Escrow already completed
    AlreadyCompleted = 3,
    /// Invalid secret provided
    InvalidSecret = 4,
    /// Finality lock still active
    FinalityLockActive = 5,
    /// Exclusive period expired
    ExclusivePeriodExpired = 6,
    /// Cancellation not yet allowed
    CancellationNotAllowed = 7,
    /// Only resolver can perform this action
    OnlyResolver = 8,
    /// Invalid amount
    InvalidAmount = 9,
    /// Insufficient safety deposit
    InsufficientSafetyDeposit = 10,
}

#[contract]
pub struct FusionEscrow;

#[contractimpl]
impl FusionEscrow {
    /// Create escrow on source chain (resolver deposits maker's tokens + safety deposit)
    pub fn create_source_escrow(
        env: Env,
        resolver: Address,
        escrow_id: BytesN<32>,
        maker: Address,
        target_address: Address,
        amount: i128,
        token: Option<Address>,
        hashlock: BytesN<32>,
        finality_duration: u64,
        exclusive_duration: u64,
        cancellation_duration: u64,
    ) -> Result<(), EscrowError> {
        resolver.require_auth();

        // Validate inputs
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        // Check if escrow already exists
        let escrow_key = DataKey::Escrow(escrow_id.clone());
        if env.storage().persistent().has(&escrow_key) {
            return Err(EscrowError::AlreadyExists);
        }

        // Calculate timelock periods
        let current_sequence = env.ledger().sequence() as u64;
        let finality_lock = current_sequence + finality_duration;
        let exclusive_lock = finality_lock + exclusive_duration;
        let cancellation_lock = exclusive_lock + cancellation_duration;

        // Safety deposit is provided by resolver (native token)
        // In real implementation, this would be validated from the transaction
        let safety_deposit = 1_000_000i128; // 1 XLM as example

        // Transfer maker's tokens from resolver to contract
        match &token {
            Some(token_address) => {
                let token_client = token::Client::new(&env, token_address);
                token_client.transfer(
                    &resolver,
                    &env.current_contract_address(),
                    &amount,
                );
            }
            None => {
                // Native XLM - resolver must have funded the contract
                // Safety deposit is included in the contract balance
            }
        }

        let escrow_data = EscrowData {
            maker: maker.clone(),
            resolver: resolver.clone(), 
            target_address: target_address.clone(),
            amount,
            safety_deposit,
            token: token.clone(),
            hashlock: hashlock.clone(),
            finality_lock,
            exclusive_lock,
            cancellation_lock,
            deposit_phase: true,
            completed: false,
        };

        // Store escrow data
        env.storage().persistent().set(&escrow_key, &escrow_data);
        env.storage().persistent().extend_ttl(&escrow_key, DEFAULT_TTL, DEFAULT_TTL);

        // Increment counter
        let counter_key = DataKey::Counter;
        let current_count: u64 = env.storage().persistent().get(&counter_key).unwrap_or(0);
        env.storage().persistent().set(&counter_key, &(current_count + 1));

        // Emit event
        env.events().publish(
            (symbol_short!("src_esc"), escrow_id.clone()),
            (maker, resolver, amount, safety_deposit),
        );

        Ok(())
    }

    /// Create escrow on destination chain (resolver deposits own tokens + safety deposit)  
    pub fn create_destination_escrow(
        env: Env,
        resolver: Address,
        escrow_id: BytesN<32>,
        maker: Address,
        amount: i128,
        token: Option<Address>,
        hashlock: BytesN<32>,
        finality_duration: u64,
        exclusive_duration: u64,
        cancellation_duration: u64,
    ) -> Result<(), EscrowError> {
        resolver.require_auth();

        // Validate inputs
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        // Check if escrow already exists
        let escrow_key = DataKey::Escrow(escrow_id.clone());
        if env.storage().persistent().has(&escrow_key) {
            return Err(EscrowError::AlreadyExists);
        }

        // Calculate timelock periods
        let current_sequence = env.ledger().sequence() as u64;
        let finality_lock = current_sequence + finality_duration;
        let exclusive_lock = finality_lock + exclusive_duration;
        let cancellation_lock = exclusive_lock + cancellation_duration;

        let safety_deposit = 1_000_000i128; // 1 XLM

        // Transfer resolver's tokens to contract
        match &token {
            Some(token_address) => {
                let token_client = token::Client::new(&env, token_address);
                token_client.transfer(
                    &resolver,
                    &env.current_contract_address(),
                    &amount,
                );
            }
            None => {
                // Native XLM transfer
            }
        }

        let escrow_data = EscrowData {
            maker: maker.clone(),
            resolver: resolver.clone(),
            target_address: maker.clone(), // On destination, tokens go to maker
            amount,
            safety_deposit,
            token: token.clone(),
            hashlock: hashlock.clone(),
            finality_lock,
            exclusive_lock,
            cancellation_lock,
            deposit_phase: true,
            completed: false,
        };

        // Store escrow data
        env.storage().persistent().set(&escrow_key, &escrow_data);
        env.storage().persistent().extend_ttl(&escrow_key, DEFAULT_TTL, DEFAULT_TTL);

        // Emit event
        env.events().publish(
            (symbol_short!("dst_esc"), escrow_id.clone()),
            (maker, resolver, amount, safety_deposit),
        );

        Ok(())
    }

    /// Claim escrow with secret (during exclusive period)
    pub fn claim_exclusive(
        env: Env,
        escrow_id: BytesN<32>,
        secret: BytesN<32>,
    ) -> Result<(), EscrowError> {
        let escrow_key = DataKey::Escrow(escrow_id.clone());
        
        let mut escrow_data: EscrowData = env.storage().persistent()
            .get(&escrow_key)
            .ok_or(EscrowError::NotFound)?;

        // Only original resolver can claim during exclusive period
        escrow_data.resolver.require_auth();

        if escrow_data.completed {
            return Err(EscrowError::AlreadyCompleted);
        }

        let current_sequence = env.ledger().sequence() as u64;

        // Check if finality lock has expired
        if current_sequence < escrow_data.finality_lock {
            return Err(EscrowError::FinalityLockActive);
        }

        // Check if still in exclusive period
        if current_sequence >= escrow_data.exclusive_lock {
            return Err(EscrowError::ExclusivePeriodExpired);
        }

        // Verify secret matches hashlock
        let secret_bytes = Bytes::from_array(&env, &secret.to_array());
        let computed_hash = env.crypto().sha256(&secret_bytes);
        if computed_hash.to_array() != escrow_data.hashlock.to_array() {
            return Err(EscrowError::InvalidSecret);
        }

        // Transfer tokens to target address
        match &escrow_data.token {
            Some(token_address) => {
                let token_client = token::Client::new(&env, token_address);
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow_data.target_address,
                    &escrow_data.amount,
                );
            }
            None => {
                // Native XLM transfer
            }
        }

        // Transfer safety deposit back to resolver

        escrow_data.completed = true;
        env.storage().persistent().set(&escrow_key, &escrow_data);
        env.storage().persistent().extend_ttl(&escrow_key, DEFAULT_TTL, DEFAULT_TTL);

        // Emit event
        env.events().publish(
            (symbol_short!("clm_exc"), escrow_id.clone()),
            (escrow_data.resolver, secret),
        );

        Ok(())
    }

    /// Claim escrow with secret (after exclusive period, any resolver)
    pub fn claim_public(
        env: Env,
        caller: Address,
        escrow_id: BytesN<32>,
        secret: BytesN<32>,
    ) -> Result<(), EscrowError> {
        caller.require_auth();

        let escrow_key = DataKey::Escrow(escrow_id.clone());
        
        let mut escrow_data: EscrowData = env.storage().persistent()
            .get(&escrow_key)
            .ok_or(EscrowError::NotFound)?;

        if escrow_data.completed {
            return Err(EscrowError::AlreadyCompleted);
        }

        let current_sequence = env.ledger().sequence() as u64;

        // Check if exclusive period has expired
        if current_sequence < escrow_data.exclusive_lock {
            return Err(EscrowError::FinalityLockActive);
        }

        // Check if not yet in cancellation period
        if current_sequence >= escrow_data.cancellation_lock {
            return Err(EscrowError::CancellationNotAllowed);
        }

        // Verify secret matches hashlock
        let secret_bytes = Bytes::from_array(&env, &secret.to_array());
        let computed_hash = env.crypto().sha256(&secret_bytes);
        if computed_hash.to_array() != escrow_data.hashlock.to_array() {
            return Err(EscrowError::InvalidSecret);
        }

        // Transfer tokens to target address
        match &escrow_data.token {
            Some(token_address) => {
                let token_client = token::Client::new(&env, token_address);
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow_data.target_address,
                    &escrow_data.amount,
                );
            }
            None => {
                // Native XLM transfer
            }
        }

        // Transfer safety deposit to caller (any resolver)

        escrow_data.completed = true;
        env.storage().persistent().set(&escrow_key, &escrow_data);
        env.storage().persistent().extend_ttl(&escrow_key, DEFAULT_TTL, DEFAULT_TTL);

        // Emit event
        env.events().publish(
            (symbol_short!("clm_pub"), escrow_id.clone()),
            (caller, secret),
        );

        Ok(())
    }

    /// Cancel escrow after timelock expires (resolver gets safety deposit)
    pub fn cancel_exclusive(env: Env, escrow_id: BytesN<32>) -> Result<(), EscrowError> {
        let escrow_key = DataKey::Escrow(escrow_id.clone());
        
        let mut escrow_data: EscrowData = env.storage().persistent()
            .get(&escrow_key)
            .ok_or(EscrowError::NotFound)?;

        // Only original resolver can cancel during exclusive period
        escrow_data.resolver.require_auth();

        if escrow_data.completed {
            return Err(EscrowError::AlreadyCompleted);
        }

        let current_sequence = env.ledger().sequence() as u64;

        // Check if cancellation period has started
        if current_sequence < escrow_data.cancellation_lock {
            return Err(EscrowError::CancellationNotAllowed);
        }

        // Return tokens to original owner (maker on source, resolver on destination)
        let return_address = if escrow_data.target_address == escrow_data.maker {
            // Destination chain: return to resolver
            escrow_data.resolver.clone()
        } else {
            // Source chain: return to maker
            escrow_data.maker.clone()
        };

        match &escrow_data.token {
            Some(token_address) => {
                let token_client = token::Client::new(&env, token_address);
                token_client.transfer(
                    &env.current_contract_address(),
                    &return_address,
                    &escrow_data.amount,
                );
            }
            None => {
                // Native XLM transfer
            }
        }

        // Safety deposit goes to resolver who canceled
        
        escrow_data.completed = true;
        env.storage().persistent().set(&escrow_key, &escrow_data);
        env.storage().persistent().extend_ttl(&escrow_key, DEFAULT_TTL, DEFAULT_TTL);

        // Emit event
        env.events().publish(
            (symbol_short!("cnl_exc"), escrow_id.clone()),
            escrow_data.resolver.clone(),
        );

        Ok(())
    }

    /// Cancel escrow after timelock expires (any resolver can claim safety deposit)
    pub fn cancel_public(env: Env, caller: Address, escrow_id: BytesN<32>) -> Result<(), EscrowError> {
        caller.require_auth();

        let escrow_key = DataKey::Escrow(escrow_id.clone());
        
        let mut escrow_data: EscrowData = env.storage().persistent()
            .get(&escrow_key)
            .ok_or(EscrowError::NotFound)?;

        if escrow_data.completed {
            return Err(EscrowError::AlreadyCompleted);
        }

        let current_sequence = env.ledger().sequence() as u64;

        // Check if in public cancellation period
        if current_sequence < escrow_data.cancellation_lock {
            return Err(EscrowError::CancellationNotAllowed);
        }

        // Calculate if exclusive cancellation period has also expired
        let exclusive_cancel_end = escrow_data.cancellation_lock + 1000; // 1000 ledgers exclusive

        if current_sequence < exclusive_cancel_end {
            // Still in exclusive period, only original resolver can cancel
            if caller != escrow_data.resolver {
                return Err(EscrowError::OnlyResolver);
            }
        }

        // Return tokens to original owner
        let return_address = if escrow_data.target_address == escrow_data.maker {
            escrow_data.resolver.clone()
        } else {
            escrow_data.maker.clone()
        };

        match &escrow_data.token {
            Some(token_address) => {
                let token_client = token::Client::new(&env, token_address);
                token_client.transfer(
                    &env.current_contract_address(),
                    &return_address,
                    &escrow_data.amount,
                );
            }
            None => {
                // Native XLM transfer
            }
        }

        // Safety deposit goes to caller (incentive for any resolver to help)

        escrow_data.completed = true;
        env.storage().persistent().set(&escrow_key, &escrow_data);
        env.storage().persistent().extend_ttl(&escrow_key, DEFAULT_TTL, DEFAULT_TTL);

        // Emit event
        env.events().publish(
            (symbol_short!("cnl_pub"), escrow_id.clone()),
            caller,
        );

        Ok(())
    }

    /// Get escrow details
    pub fn get_escrow(env: Env, escrow_id: BytesN<32>) -> Option<EscrowData> {
        let escrow_key = DataKey::Escrow(escrow_id);
        env.storage().persistent().get(&escrow_key)
    }

    /// Get escrow count
    pub fn get_escrow_count(env: Env) -> u64 {
        let counter_key = DataKey::Counter;
        env.storage().persistent().get(&counter_key).unwrap_or(0)
    }

    /// Extend escrow storage TTL
    pub fn extend_escrow_ttl(env: Env, escrow_id: BytesN<32>, extend_to: u32) {
        let escrow_key = DataKey::Escrow(escrow_id);
        env.storage().persistent().extend_ttl(&escrow_key, extend_to, extend_to);
    }
}

mod test;
