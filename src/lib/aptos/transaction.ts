import "server-only";
import {
  AccountAddress,
  AccountAuthenticatorMultiEd25519,
  Deserializer,
  generateSigningMessageForTransaction,
  type MultiEd25519PublicKey,
  type MultiEd25519Signature,
  Serializer,
  SimpleTransaction,
} from "@aptos-labs/ts-sdk";
import { type AptosNetwork, getAptosClient } from "./client";

export interface EntryFunctionPayload {
  module: string;
  function: string;
  typeArgs: string[];
  args: string[];
}

export interface TransactionConfig {
  multisigAddress: string;
  payload: EntryFunctionPayload;
  maxGasAmount?: number;
  gasUnitPrice?: number;
  expirationSeconds?: number;
  feePayerAddress?: string;
  network: AptosNetwork;
  /**
   * Fix the on-chain sequence number rather than letting the SDK fetch it.
   * Required when re-building a transaction whose bytes a client has already
   * signed (e.g. a creator-proof signature), so the server-rebuilt bytes are
   * byte-identical to the client-signed bytes.
   */
  accountSequenceNumber?: number;
  /**
   * Fix the absolute expiration timestamp (unix seconds) rather than deriving
   * one from `expirationSeconds + Date.now()`. Same use case as
   * `accountSequenceNumber`: required to make rebuilds deterministic.
   */
  expirationTimestampSecs?: number;
}

export interface BuiltTransaction {
  rawTransactionBytes: string; // hex-encoded serialized SimpleTransaction
  sequenceNumber: number;
  maxGasAmount: number;
  gasUnitPrice: number;
  expirationTimestampSecs: number;
  signingMessage: Uint8Array;
}

export async function buildTransaction(
  config: TransactionConfig,
): Promise<BuiltTransaction> {
  const aptos = getAptosClient(config.network);
  const senderAddress = AccountAddress.from(config.multisigAddress);
  const expirationSeconds = config.expirationSeconds ?? 86400;
  const maxGasAmount = config.maxGasAmount ?? 100000;
  const gasUnitPrice = config.gasUnitPrice ?? 100;

  const expireTimestamp =
    config.expirationTimestampSecs ??
    Math.floor(Date.now() / 1000) + expirationSeconds;

  const transaction = await aptos.transaction.build.simple({
    sender: senderAddress,
    data: {
      function:
        `${config.payload.module}::${config.payload.function}` as `${string}::${string}::${string}`,
      typeArguments: config.payload.typeArgs,
      functionArguments: config.payload.args,
    },
    options: {
      maxGasAmount,
      gasUnitPrice,
      expireTimestamp,
      ...(config.accountSequenceNumber !== undefined
        ? { accountSequenceNumber: config.accountSequenceNumber }
        : {}),
    },
    ...(config.feePayerAddress ? { withFeePayer: true } : {}),
  });

  const rawTxn = transaction.rawTransaction;
  const serializer = new Serializer();
  transaction.serialize(serializer);
  const rawTransactionBytes = Buffer.from(serializer.toUint8Array()).toString(
    "hex",
  );
  const signingMessage = generateSigningMessageForTransaction(transaction);

  return {
    rawTransactionBytes,
    sequenceNumber: Number(rawTxn.sequence_number),
    maxGasAmount: Number(rawTxn.max_gas_amount),
    gasUnitPrice: Number(rawTxn.gas_unit_price),
    expirationTimestampSecs: Number(rawTxn.expiration_timestamp_secs),
    signingMessage,
  };
}

export function deserializeSimpleTransaction(hex: string): SimpleTransaction {
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  const deserializer = new Deserializer(bytes);
  return SimpleTransaction.deserialize(deserializer);
}

/** Alias for spec compatibility */
export const deserializeRawTransaction = deserializeSimpleTransaction;

export async function submitMultisigTransaction(params: {
  rawTransactionBytes: string;
  multiPublicKey: MultiEd25519PublicKey;
  multiSignature: MultiEd25519Signature;
  network: AptosNetwork;
}): Promise<string> {
  const aptos = getAptosClient(params.network);
  const transaction = deserializeSimpleTransaction(params.rawTransactionBytes);

  const authenticator = new AccountAuthenticatorMultiEd25519(
    params.multiPublicKey,
    params.multiSignature,
  );

  const response = await aptos.transaction.submit.simple({
    transaction,
    senderAuthenticator: authenticator,
  });

  // Return the hash immediately — don't wait for on-chain confirmation.
  // The caller should poll /api/proposal/{id}/check-status for the result.
  return response.hash;
}
