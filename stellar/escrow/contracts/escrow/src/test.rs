#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short, testutils::{Address as _, Ledger, Events}, vec, Env, BytesN
};

fn create_test_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let contract_id = env.register_contract(None, EscrowContract);
    let alice = Address::generate(&env); // maker
    let bob = Address::generate(&env);   // taker
    (env, contract_id, alice, bob)
}

fn create_test_token(env: &Env) -> Address {
    // Mock a token contract address for testing
    Address::generate(env)
}

fn generate_secret_and_hash(env: &Env) -> (BytesN<32>, BytesN<32>) {
    let secret = BytesN::from_array(env, &[1; 32]);
    let hashlock = env.crypto().sha256(&secret);
    (secret, hashlock)
}

#[test]
fn test_create_escrow_success() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let token = Some(create_test_token(&env));
    let (_, hashlock) = generate_secret_and_hash(&env);
    let timelock_duration = 100u64;

    // Create escrow
    let result = client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &token,
        &hashlock,
        &timelock_duration,
    );
    
    assert!(result.is_ok());

    // Verify escrow was created
    let escrow_data = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow_data.taker, bob);
    assert_eq!(escrow_data.amount, amount);
    assert_eq!(escrow_data.token, token);
    assert_eq!(escrow_data.hashlock, hashlock);
    assert!(!escrow_data.funded);
    assert!(!escrow_data.completed);

    // Check counter was incremented
    assert_eq!(client.get_escrow_count(), 1);
}

#[test]
fn test_create_escrow_invalid_amount() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = -100i128; // Invalid amount
    let (_, hashlock) = generate_secret_and_hash(&env);

    let result = client.try_create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &None,
        &hashlock,
        &100u64,
    );
    
    assert_eq!(result, Err(Ok(EscrowError::InvalidAmount)));
}

#[test]
fn test_create_escrow_already_exists() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let (_, hashlock) = generate_secret_and_hash(&env);

    // Create first escrow
    client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &None,
        &hashlock,
        &100u64,
    );

    // Try to create same escrow again
    let result = client.try_create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &None,
        &hashlock,
        &100u64,
    );
    
    assert_eq!(result, Err(Ok(EscrowError::AlreadyExists)));
}

#[test]
fn test_fund_escrow_success() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let token = Some(create_test_token(&env));
    let (_, hashlock) = generate_secret_and_hash(&env);

    // Create escrow
    client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &token,
        &hashlock,
        &100u64,
    );

    // Mock token authorization for alice
    env.mock_all_auths();

    // Fund escrow
    let result = client.fund_escrow(&escrow_id);
    assert!(result.is_ok());

    // Verify escrow is now funded
    let escrow_data = client.get_escrow(&escrow_id).unwrap();
    assert!(escrow_data.funded);
    assert!(!escrow_data.completed);
}

#[test]
fn test_claim_escrow_success() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let token = Some(create_test_token(&env));
    let (secret, hashlock) = generate_secret_and_hash(&env);

    // Create and fund escrow
    client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &token,
        &hashlock,
        &100u64,
    );

    env.mock_all_auths();
    client.fund_escrow(&escrow_id);

    // Claim escrow with correct secret
    let result = client.claim(&escrow_id, &secret);
    assert!(result.is_ok());

    // Verify escrow is completed
    let escrow_data = client.get_escrow(&escrow_id).unwrap();
    assert!(escrow_data.funded);
    assert!(escrow_data.completed);

    // Check events
    let events = env.events().all();
    let claim_event = events.iter().find(|e| {
        e.topics.get(0).unwrap() == &symbol_short!("escrow_claimed")
    });
    assert!(claim_event.is_some());
}

#[test]
fn test_claim_escrow_invalid_secret() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let (_, hashlock) = generate_secret_and_hash(&env);
    let wrong_secret = BytesN::from_array(&env, &[2; 32]); // Wrong secret

    // Create and fund escrow
    client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &None,
        &hashlock,
        &100u64,
    );

    env.mock_all_auths();
    client.fund_escrow(&escrow_id);

    // Try to claim with incorrect secret
    let result = client.try_claim(&escrow_id, &wrong_secret);
    assert_eq!(result, Err(Ok(EscrowError::InvalidSecret)));

    // Verify escrow is still not completed
    let escrow_data = client.get_escrow(&escrow_id).unwrap();
    assert!(escrow_data.funded);
    assert!(!escrow_data.completed);
}

#[test]
fn test_cancel_escrow_success() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let (_, hashlock) = generate_secret_and_hash(&env);
    let timelock_duration = 10u64;

    // Create and fund escrow
    client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &None,
        &hashlock,
        &timelock_duration,
    );

    env.mock_all_auths();
    client.fund_escrow(&escrow_id);

    // Advance ledger beyond timelock
    env.ledger().with_mut(|li| {
        li.sequence_number += timelock_duration + 1;
    });

    // Cancel escrow
    let result = client.cancel(&escrow_id);
    assert!(result.is_ok());

    // Verify escrow is completed
    let escrow_data = client.get_escrow(&escrow_id).unwrap();
    assert!(escrow_data.funded);
    assert!(escrow_data.completed);
}

#[test]
fn test_cancel_escrow_timelock_not_expired() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let (_, hashlock) = generate_secret_and_hash(&env);
    let timelock_duration = 100u64;

    // Create and fund escrow
    client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &None,
        &hashlock,
        &timelock_duration,
    );

    env.mock_all_auths();
    client.fund_escrow(&escrow_id);

    // Try to cancel before timelock expires
    let result = client.try_cancel(&escrow_id);
    assert_eq!(result, Err(Ok(EscrowError::TimelockNotExpired)));

    // Verify escrow is still active
    let escrow_data = client.get_escrow(&escrow_id).unwrap();
    assert!(escrow_data.funded);
    assert!(!escrow_data.completed);
}

#[test]
fn test_get_nonexistent_escrow() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    
    // Try to get non-existent escrow
    let result = client.get_escrow(&escrow_id);
    assert!(result.is_none());
}

#[test]
fn test_escrow_counter() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    // Initially counter should be 0
    assert_eq!(client.get_escrow_count(), 0);

    let (_, hashlock) = generate_secret_and_hash(&env);

    // Create first escrow
    let escrow_id1 = BytesN::from_array(&env, &[1; 32]);
    client.create_escrow(
        &escrow_id1,
        &bob,
        &1000i128,
        &None,
        &hashlock,
        &100u64,
    );
    assert_eq!(client.get_escrow_count(), 1);

    // Create second escrow
    let escrow_id2 = BytesN::from_array(&env, &[2; 32]);
    client.create_escrow(
        &escrow_id2,
        &bob,
        &2000i128,
        &None,
        &hashlock,
        &100u64,
    );
    assert_eq!(client.get_escrow_count(), 2);
}

#[test]
fn test_events_emission() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let amount = 1000i128;
    let (secret, hashlock) = generate_secret_and_hash(&env);

    // Create escrow and check event
    client.create_escrow(
        &escrow_id,
        &bob,
        &amount,
        &None,
        &hashlock,
        &100u64,
    );

    let events = env.events().all();
    let create_event = events.iter().find(|e| {
        e.topics.get(0).unwrap() == &symbol_short!("escrow_created")
    });
    assert!(create_event.is_some());

    // Fund escrow and check event
    env.mock_all_auths();
    client.fund_escrow(&escrow_id);

    let events = env.events().all();
    let fund_event = events.iter().find(|e| {
        e.topics.get(0).unwrap() == &symbol_short!("escrow_funded")
    });
    assert!(fund_event.is_some());
}

#[test]
fn test_ttl_extension() {
    let (env, contract_id, alice, bob) = create_test_env();
    let client = EscrowContractClient::new(&env, &contract_id);
    
    let escrow_id = BytesN::from_array(&env, &[1; 32]);
    let (_, hashlock) = generate_secret_and_hash(&env);

    // Create escrow
    client.create_escrow(
        &escrow_id,
        &bob,
        &1000i128,
        &None,
        &hashlock,
        &100u64,
    );

    // Extend TTL (this should not panic)
    client.extend_escrow_ttl(&escrow_id, &17280); // 60 days
}
