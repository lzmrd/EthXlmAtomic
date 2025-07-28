import { Buffer } from "buffer";
import { Address } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Typepoint,
  Duration,
} from '@stellar/stellar-sdk/contract';
export * from '@stellar/stellar-sdk'
export * as contract from '@stellar/stellar-sdk/contract'
export * as rpc from '@stellar/stellar-sdk/rpc'

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCB6JCJT4MRT342PJE3TU3W6L7CB3RGHGFRNXIPVNX3LGITYMAW7RS74",
  }
} as const


export interface EscrowData {
  /**
 * Amount locked in escrow (maker's tokens)
 */
amount: i128;
  /**
 * Final cancellation timelock expiration
 */
cancellation_lock: u64;
  /**
 * Whether escrow is completed (claimed or cancelled)
 */
completed: boolean;
  /**
 * Whether escrow is in deposit phase (finality lock active)
 */
deposit_phase: boolean;
  /**
 * Exclusive withdrawal period expiration (for resolver)
 */
exclusive_lock: u64;
  /**
 * Finality lock expiration (ledger sequence)
 */
finality_lock: u64;
  /**
 * Hash of the secret required to claim
 */
hashlock: Buffer;
  /**
 * Maker address (who owns the tokens being swapped)
 */
maker: string;
  /**
 * Resolver address (who creates and manages the escrow)
 */
resolver: string;
  /**
 * Safety deposit amount in native token
 */
safety_deposit: i128;
  /**
 * Target withdrawal address (where tokens go on claim)
 */
target_address: string;
  /**
 * Token contract address (for Stellar Asset Contract tokens)
 * Use native token if this is None
 */
token: Option<string>;
}

export type DataKey = {tag: "Escrow", values: readonly [Buffer]} | {tag: "Counter", values: void};

export const EscrowError = {
  /**
   * Escrow not found
   */
  1: {message:"NotFound"},
  /**
   * Escrow already exists
   */
  2: {message:"AlreadyExists"},
  /**
   * Escrow already completed
   */
  3: {message:"AlreadyCompleted"},
  /**
   * Invalid secret provided
   */
  4: {message:"InvalidSecret"},
  /**
   * Finality lock still active
   */
  5: {message:"FinalityLockActive"},
  /**
   * Exclusive period expired
   */
  6: {message:"ExclusivePeriodExpired"},
  /**
   * Cancellation not yet allowed
   */
  7: {message:"CancellationNotAllowed"},
  /**
   * Only resolver can perform this action
   */
  8: {message:"OnlyResolver"},
  /**
   * Invalid amount
   */
  9: {message:"InvalidAmount"},
  /**
   * Insufficient safety deposit
   */
  10: {message:"InsufficientSafetyDeposit"}
}

export interface Client {
  /**
   * Construct and simulate a create_source_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create escrow on source chain (resolver deposits maker's tokens + safety deposit)
   */
  create_source_escrow: ({escrow_id, maker, target_address, amount, token, hashlock, finality_duration, exclusive_duration, cancellation_duration}: {escrow_id: Buffer, maker: string, target_address: string, amount: i128, token: Option<string>, hashlock: Buffer, finality_duration: u64, exclusive_duration: u64, cancellation_duration: u64}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_destination_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create escrow on destination chain (resolver deposits own tokens + safety deposit)
   */
  create_destination_escrow: ({escrow_id, maker, amount, token, hashlock, finality_duration, exclusive_duration, cancellation_duration}: {escrow_id: Buffer, maker: string, amount: i128, token: Option<string>, hashlock: Buffer, finality_duration: u64, exclusive_duration: u64, cancellation_duration: u64}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_exclusive transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Claim escrow with secret (during exclusive period)
   */
  claim_exclusive: ({escrow_id, secret}: {escrow_id: Buffer, secret: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_public transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Claim escrow with secret (after exclusive period, any resolver)
   */
  claim_public: ({escrow_id, secret}: {escrow_id: Buffer, secret: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_exclusive transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel escrow after timelock expires (resolver gets safety deposit)
   */
  cancel_exclusive: ({escrow_id}: {escrow_id: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_public transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel escrow after timelock expires (any resolver can claim safety deposit)
   */
  cancel_public: ({escrow_id}: {escrow_id: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_escrow transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get escrow details
   */
  get_escrow: ({escrow_id}: {escrow_id: Buffer}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Option<EscrowData>>>

  /**
   * Construct and simulate a get_escrow_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get escrow count
   */
  get_escrow_count: (options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a extend_escrow_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Extend escrow storage TTL
   */
  extend_escrow_ttl: ({escrow_id, extend_to}: {escrow_id: Buffer, extend_to: u32}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAACkVzY3Jvd0RhdGEAAAAAAAwAAAAoQW1vdW50IGxvY2tlZCBpbiBlc2Nyb3cgKG1ha2VyJ3MgdG9rZW5zKQAAAAZhbW91bnQAAAAAAAsAAAAmRmluYWwgY2FuY2VsbGF0aW9uIHRpbWVsb2NrIGV4cGlyYXRpb24AAAAAABFjYW5jZWxsYXRpb25fbG9jawAAAAAAAAYAAAAyV2hldGhlciBlc2Nyb3cgaXMgY29tcGxldGVkIChjbGFpbWVkIG9yIGNhbmNlbGxlZCkAAAAAAAljb21wbGV0ZWQAAAAAAAABAAAAOVdoZXRoZXIgZXNjcm93IGlzIGluIGRlcG9zaXQgcGhhc2UgKGZpbmFsaXR5IGxvY2sgYWN0aXZlKQAAAAAAAA1kZXBvc2l0X3BoYXNlAAAAAAAAAQAAADVFeGNsdXNpdmUgd2l0aGRyYXdhbCBwZXJpb2QgZXhwaXJhdGlvbiAoZm9yIHJlc29sdmVyKQAAAAAAAA5leGNsdXNpdmVfbG9jawAAAAAABgAAACpGaW5hbGl0eSBsb2NrIGV4cGlyYXRpb24gKGxlZGdlciBzZXF1ZW5jZSkAAAAAAA1maW5hbGl0eV9sb2NrAAAAAAAABgAAACRIYXNoIG9mIHRoZSBzZWNyZXQgcmVxdWlyZWQgdG8gY2xhaW0AAAAIaGFzaGxvY2sAAAPuAAAAIAAAADFNYWtlciBhZGRyZXNzICh3aG8gb3ducyB0aGUgdG9rZW5zIGJlaW5nIHN3YXBwZWQpAAAAAAAABW1ha2VyAAAAAAAAEwAAADVSZXNvbHZlciBhZGRyZXNzICh3aG8gY3JlYXRlcyBhbmQgbWFuYWdlcyB0aGUgZXNjcm93KQAAAAAAAAhyZXNvbHZlcgAAABMAAAAlU2FmZXR5IGRlcG9zaXQgYW1vdW50IGluIG5hdGl2ZSB0b2tlbgAAAAAAAA5zYWZldHlfZGVwb3NpdAAAAAAACwAAADRUYXJnZXQgd2l0aGRyYXdhbCBhZGRyZXNzICh3aGVyZSB0b2tlbnMgZ28gb24gY2xhaW0pAAAADnRhcmdldF9hZGRyZXNzAAAAAAATAAAAW1Rva2VuIGNvbnRyYWN0IGFkZHJlc3MgKGZvciBTdGVsbGFyIEFzc2V0IENvbnRyYWN0IHRva2VucykKVXNlIG5hdGl2ZSB0b2tlbiBpZiB0aGlzIGlzIE5vbmUAAAAABXRva2VuAAAAAAAD6AAAABM=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAEAAAAAAAAABkVzY3JvdwAAAAAAAQAAA+4AAAAgAAAAAAAAAAAAAAAHQ291bnRlcgA=",
        "AAAABAAAAAAAAAAAAAAAC0VzY3Jvd0Vycm9yAAAAAAoAAAAQRXNjcm93IG5vdCBmb3VuZAAAAAhOb3RGb3VuZAAAAAEAAAAVRXNjcm93IGFscmVhZHkgZXhpc3RzAAAAAAAADUFscmVhZHlFeGlzdHMAAAAAAAACAAAAGEVzY3JvdyBhbHJlYWR5IGNvbXBsZXRlZAAAABBBbHJlYWR5Q29tcGxldGVkAAAAAwAAABdJbnZhbGlkIHNlY3JldCBwcm92aWRlZAAAAAANSW52YWxpZFNlY3JldAAAAAAAAAQAAAAaRmluYWxpdHkgbG9jayBzdGlsbCBhY3RpdmUAAAAAABJGaW5hbGl0eUxvY2tBY3RpdmUAAAAAAAUAAAAYRXhjbHVzaXZlIHBlcmlvZCBleHBpcmVkAAAAFkV4Y2x1c2l2ZVBlcmlvZEV4cGlyZWQAAAAAAAYAAAAcQ2FuY2VsbGF0aW9uIG5vdCB5ZXQgYWxsb3dlZAAAABZDYW5jZWxsYXRpb25Ob3RBbGxvd2VkAAAAAAAHAAAAJU9ubHkgcmVzb2x2ZXIgY2FuIHBlcmZvcm0gdGhpcyBhY3Rpb24AAAAAAAAMT25seVJlc29sdmVyAAAACAAAAA5JbnZhbGlkIGFtb3VudAAAAAAADUludmFsaWRBbW91bnQAAAAAAAAJAAAAG0luc3VmZmljaWVudCBzYWZldHkgZGVwb3NpdAAAAAAZSW5zdWZmaWNpZW50U2FmZXR5RGVwb3NpdAAAAAAAAAo=",
        "AAAAAAAAAFFDcmVhdGUgZXNjcm93IG9uIHNvdXJjZSBjaGFpbiAocmVzb2x2ZXIgZGVwb3NpdHMgbWFrZXIncyB0b2tlbnMgKyBzYWZldHkgZGVwb3NpdCkAAAAAAAAUY3JlYXRlX3NvdXJjZV9lc2Nyb3cAAAAJAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAPuAAAAIAAAAAAAAAAFbWFrZXIAAAAAAAATAAAAAAAAAA50YXJnZXRfYWRkcmVzcwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAV0b2tlbgAAAAAAA+gAAAATAAAAAAAAAAhoYXNobG9jawAAA+4AAAAgAAAAAAAAABFmaW5hbGl0eV9kdXJhdGlvbgAAAAAAAAYAAAAAAAAAEmV4Y2x1c2l2ZV9kdXJhdGlvbgAAAAAABgAAAAAAAAAVY2FuY2VsbGF0aW9uX2R1cmF0aW9uAAAAAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAAFJDcmVhdGUgZXNjcm93IG9uIGRlc3RpbmF0aW9uIGNoYWluIChyZXNvbHZlciBkZXBvc2l0cyBvd24gdG9rZW5zICsgc2FmZXR5IGRlcG9zaXQpAAAAAAAZY3JlYXRlX2Rlc3RpbmF0aW9uX2VzY3JvdwAAAAAAAAgAAAAAAAAACWVzY3Jvd19pZAAAAAAAA+4AAAAgAAAAAAAAAAVtYWtlcgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAFdG9rZW4AAAAAAAPoAAAAEwAAAAAAAAAIaGFzaGxvY2sAAAPuAAAAIAAAAAAAAAARZmluYWxpdHlfZHVyYXRpb24AAAAAAAAGAAAAAAAAABJleGNsdXNpdmVfZHVyYXRpb24AAAAAAAYAAAAAAAAAFWNhbmNlbGxhdGlvbl9kdXJhdGlvbgAAAAAAAAYAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtFc2Nyb3dFcnJvcgA=",
        "AAAAAAAAADJDbGFpbSBlc2Nyb3cgd2l0aCBzZWNyZXQgKGR1cmluZyBleGNsdXNpdmUgcGVyaW9kKQAAAAAAD2NsYWltX2V4Y2x1c2l2ZQAAAAACAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAPuAAAAIAAAAAAAAAAGc2VjcmV0AAAAAAPuAAAAIAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAAD9DbGFpbSBlc2Nyb3cgd2l0aCBzZWNyZXQgKGFmdGVyIGV4Y2x1c2l2ZSBwZXJpb2QsIGFueSByZXNvbHZlcikAAAAADGNsYWltX3B1YmxpYwAAAAIAAAAAAAAACWVzY3Jvd19pZAAAAAAAA+4AAAAgAAAAAAAAAAZzZWNyZXQAAAAAA+4AAAAgAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALRXNjcm93RXJyb3IA",
        "AAAAAAAAAENDYW5jZWwgZXNjcm93IGFmdGVyIHRpbWVsb2NrIGV4cGlyZXMgKHJlc29sdmVyIGdldHMgc2FmZXR5IGRlcG9zaXQpAAAAABBjYW5jZWxfZXhjbHVzaXZlAAAAAQAAAAAAAAAJZXNjcm93X2lkAAAAAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtFc2Nyb3dFcnJvcgA=",
        "AAAAAAAAAExDYW5jZWwgZXNjcm93IGFmdGVyIHRpbWVsb2NrIGV4cGlyZXMgKGFueSByZXNvbHZlciBjYW4gY2xhaW0gc2FmZXR5IGRlcG9zaXQpAAAADWNhbmNlbF9wdWJsaWMAAAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAPuAAAAIAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC0VzY3Jvd0Vycm9yAA==",
        "AAAAAAAAABJHZXQgZXNjcm93IGRldGFpbHMAAAAAAApnZXRfZXNjcm93AAAAAAABAAAAAAAAAAllc2Nyb3dfaWQAAAAAAAPuAAAAIAAAAAEAAAPoAAAH0AAAAApFc2Nyb3dEYXRhAAA=",
        "AAAAAAAAABBHZXQgZXNjcm93IGNvdW50AAAAEGdldF9lc2Nyb3dfY291bnQAAAAAAAAAAQAAAAY=",
        "AAAAAAAAABlFeHRlbmQgZXNjcm93IHN0b3JhZ2UgVFRMAAAAAAAAEWV4dGVuZF9lc2Nyb3dfdHRsAAAAAAAAAgAAAAAAAAAJZXNjcm93X2lkAAAAAAAD7gAAACAAAAAAAAAACWV4dGVuZF90bwAAAAAAAAQAAAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    create_source_escrow: this.txFromJSON<Result<void>>,
        create_destination_escrow: this.txFromJSON<Result<void>>,
        claim_exclusive: this.txFromJSON<Result<void>>,
        claim_public: this.txFromJSON<Result<void>>,
        cancel_exclusive: this.txFromJSON<Result<void>>,
        cancel_public: this.txFromJSON<Result<void>>,
        get_escrow: this.txFromJSON<Option<EscrowData>>,
        get_escrow_count: this.txFromJSON<u64>,
        extend_escrow_ttl: this.txFromJSON<null>
  }
}