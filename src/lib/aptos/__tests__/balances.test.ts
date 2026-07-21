import { describe, expect, it } from "vitest";
import {
  buildTransferProposeHref,
  classifyAssetKind,
  formatAssetAmount,
  mapIndexerCoinBalances,
  shortAssetLabel,
} from "../balances";

describe("classifyAssetKind", () => {
  it("uses token_standard v1/v2 when present", () => {
    expect(
      classifyAssetKind({
        token_standard: "v1",
        asset_type: "0x1::aptos_coin::AptosCoin",
      }),
    ).toBe("coin");
    expect(
      classifyAssetKind({
        token_standard: "v2",
        asset_type: "0xa",
      }),
    ).toBe("fa");
  });

  it("falls back to asset_type shape", () => {
    expect(classifyAssetKind({ asset_type: "0x1::coin::Other" })).toBe("coin");
    expect(classifyAssetKind({ asset_type: "0xabc" })).toBe("fa");
  });
});

describe("mapIndexerCoinBalances", () => {
  it("maps coin and FA rows and drops zero balances", () => {
    const result = mapIndexerCoinBalances([
      {
        amount: "100000000",
        asset_type: "0x1::aptos_coin::AptosCoin",
        token_standard: "v1",
        is_frozen: false,
        metadata: {
          symbol: "APT",
          name: "Aptos Coin",
          decimals: 8,
          token_standard: "v1",
        },
      },
      {
        amount: 0,
        asset_type: "0xdead",
        token_standard: "v2",
      },
      {
        amount: "5000",
        asset_type: "0xabc",
        token_standard: "v2",
        is_primary: true,
        metadata: {
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
        },
      },
      {
        amount: "1",
        // missing asset_type
        token_standard: "v1",
      },
    ]);

    expect(result).toEqual([
      {
        asset: "0x1::aptos_coin::AptosCoin",
        amount: "100000000",
        kind: "coin",
        symbol: "APT",
        name: "Aptos Coin",
        decimals: 8,
        isFrozen: false,
        isPrimary: undefined,
      },
      {
        asset: "0xabc",
        amount: "5000",
        kind: "fa",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        isFrozen: undefined,
        isPrimary: true,
      },
    ]);
  });

  it("accepts bigint amounts", () => {
    const result = mapIndexerCoinBalances([
      {
        amount: 42n,
        asset_type: "0x1::coin::X",
        token_standard: "v1",
      },
    ]);
    expect(result[0]?.amount).toBe("42");
  });
});

describe("formatAssetAmount", () => {
  it("formats with decimals", () => {
    expect(formatAssetAmount("100000000", 8)).toBe("1");
    expect(formatAssetAmount("1500000", 6)).toBe("1.5");
    expect(formatAssetAmount("123456789", 8)).toBe("1.23456789");
  });

  it("formats without decimals", () => {
    expect(formatAssetAmount("1000", null)).toBe("1,000");
  });
});

describe("buildTransferProposeHref", () => {
  it("builds transfer_coins URL for coins", () => {
    const href = buildTransferProposeHref({
      multisigAddress: "0xmsig",
      network: "mainnet",
      balance: {
        asset: "0x1::aptos_coin::AptosCoin",
        amount: "1",
        kind: "coin",
        symbol: "APT",
      },
    });
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/multisig/0xmsig/propose");
    expect(url.searchParams.get("module")).toBe("0x1");
    expect(url.searchParams.get("name")).toBe("aptos_account");
    expect(url.searchParams.get("function")).toBe("transfer_coins");
    expect(url.searchParams.get("type_args")).toBe(
      "0x1::aptos_coin::AptosCoin",
    );
    expect(url.searchParams.get("args")).toBeNull();
    expect(url.searchParams.get("desc")).toBe("Transfer APT");
  });

  it("builds primary_fungible_store::transfer URL for FAs", () => {
    const href = buildTransferProposeHref({
      multisigAddress: "0xmsig",
      network: "testnet",
      balance: {
        asset: "0xusdcmeta",
        amount: "1",
        kind: "fa",
        symbol: "USDC",
      },
    });
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("name")).toBe("primary_fungible_store");
    expect(url.searchParams.get("function")).toBe("transfer");
    expect(url.searchParams.get("type_args")).toBe(
      "0x1::fungible_asset::Metadata",
    );
    expect(url.searchParams.get("args")).toBe("0xusdcmeta");
    expect(url.searchParams.get("network")).toBe("testnet");
  });
});

describe("shortAssetLabel", () => {
  it("uses the last Move type segment", () => {
    expect(shortAssetLabel("0x1::aptos_coin::AptosCoin")).toBe("AptosCoin");
  });

  it("truncates long addresses", () => {
    const addr = `0x${"a".repeat(64)}`;
    expect(shortAssetLabel(addr)).toMatch(/^0xaaaaaa…aaaa$/);
  });
});
