import { NextRequest, NextResponse } from "next/server";

/**
 * Full reverse proxy for the dApp browser.
 *
 * Usage: /api/dapp-proxy/{path}?origin=https://app.ariesmarkets.xyz
 *
 * - Proxies ALL requests (HTML, JS, CSS, API calls, images) to the target origin
 * - Injects the wallet script into HTML responses
 * - Preserves headers, cookies, and content types
 * - The iframe loads /api/dapp-proxy/?origin=... and all relative URLs
 *   naturally route through this proxy
 */

const WALLET_INJECT_SCRIPT = `
<script data-multisig-wallet-inject="true">
(function() {
  'use strict';

  // ── Parent frame communication ──────────────────────────────────────
  var resolvers = {};
  var requestId = 0;

  window.addEventListener("message", function(event) {
    if (event.data && event.data.type === "MULTISIG_WALLET_RESPONSE") {
      var resolver = resolvers[event.data.id];
      if (resolver) {
        if (event.data.error) resolver.reject(new Error(event.data.error));
        else resolver.resolve(event.data.result);
        delete resolvers[event.data.id];
      }
    }
  });

  function sendToParent(method, params) {
    return new Promise(function(resolve, reject) {
      var id = ++requestId;
      resolvers[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage(
        { type: "MULTISIG_WALLET_REQUEST", id: id, method: method, params: params },
        "*"
      );
    });
  }

  // ── Legacy window.aptos override ────────────────────────────────────
  var accountChangeCallbacks = [];
  var networkChangeCallbacks = [];

  Object.defineProperty(window, "aptos", {
    value: {
      connect: function() { return sendToParent("connect", {}); },
      disconnect: function() { return sendToParent("disconnect", {}); },
      account: function() { return sendToParent("account", {}); },
      network: function() { return sendToParent("network", {}); },
      signMessage: function(p) { return sendToParent("signMessage", p); },
      signTransaction: function(p) { return sendToParent("signTransaction", p); },
      signAndSubmitTransaction: function(p) { return sendToParent("signAndSubmitTransaction", p); },
      onAccountChange: function(cb) { accountChangeCallbacks.push(cb); },
      onNetworkChange: function(cb) { networkChangeCallbacks.push(cb); },
      isConnected: function() { return sendToParent("isConnected", {}); },
    },
    writable: false,
    configurable: false,
  });

  // ── AIP-62 Wallet Standard registration ─────────────────────────────
  var WALLET_NAME = "Multisig Wallet";
  var WALLET_ICON = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjMjAyMDIwIi8+PHRleHQgeD0iMTIiIHk9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSJ3aGl0ZSIgZm9udC1zaXplPSIxMiIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiPk08L3RleHQ+PC9zdmc+";

  var wallet = {
    version: "1.0.0",
    name: WALLET_NAME,
    icon: WALLET_ICON,
    chains: ["aptos:mainnet", "aptos:testnet", "aptos:devnet"],
    accounts: [],
    url: window.location.origin,
    features: {
      "aptos:connect": {
        version: "1.1.0",
        connect: function() {
          return sendToParent("connect", {}).then(function(acc) {
            wallet.accounts = [{ address: acc.address || "", publicKey: new Uint8Array(32), chains: wallet.chains, features: Object.keys(wallet.features) }];
            return { status: "Approved", args: acc };
          });
        },
      },
      "aptos:account": {
        version: "1.0.0",
        account: function() { return sendToParent("account", {}); },
      },
      "aptos:network": {
        version: "1.0.0",
        network: function() { return sendToParent("network", {}); },
      },
      "aptos:signTransaction": {
        version: "1.1.0",
        signTransaction: function(input) { return sendToParent("signTransaction", input); },
      },
      "aptos:signAndSubmitTransaction": {
        version: "1.0.0",
        signAndSubmitTransaction: function(input) { return sendToParent("signAndSubmitTransaction", input); },
      },
      "aptos:signMessage": {
        version: "1.0.0",
        signMessage: function(input) { return sendToParent("signMessage", input); },
      },
      "aptos:onAccountChange": {
        version: "1.0.0",
        onAccountChange: function(cb) { accountChangeCallbacks.push(cb); },
      },
      "aptos:onNetworkChange": {
        version: "1.0.0",
        onNetworkChange: function(cb) { networkChangeCallbacks.push(cb); },
      },
      "aptos:disconnect": {
        version: "1.0.0",
        disconnect: function() { wallet.accounts = []; return Promise.resolve(); },
      },
      "aptos:changeNetwork": {
        version: "1.0.0",
        changeNetwork: function(net) { return sendToParent("changeNetwork", net); },
      },
    },
  };

  // Expose features at top level too (some adapters check both)
  Object.keys(wallet.features).forEach(function(k) { wallet[k] = wallet.features[k]; });

  function registerWallet() {
    // Method 1: wallet tells dApp it exists
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
        bubbles: false, cancelable: false,
        detail: function(api) { api.register(wallet); },
      }));
    } catch(e) {}

    // Method 2: dApp asks wallets to register
    window.addEventListener("wallet-standard:app-ready", function(e) {
      try { if (e.detail && typeof e.detail.register === "function") e.detail.register(wallet); } catch(e) {}
    });

    // Method 3: legacy
    try {
      if (!window.navigator.wallets) window.navigator.wallets = [];
      if (Array.isArray(window.navigator.wallets)) {
        window.navigator.wallets.push(function(api) { api.register(wallet); });
      }
    } catch(e) {}
  }

  registerWallet();
  console.log("[MultisigWallet] AIP-62 wallet registered");
})();
</script>`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const origin = request.nextUrl.searchParams.get("origin");

  if (!origin) {
    return NextResponse.json(
      { error: "Missing origin query parameter" },
      { status: 400 }
    );
  }

  // Build target URL: origin + path segments + original query params (minus our "origin" param)
  const pathStr = path?.join("/") ?? "";
  const targetUrl = new URL(pathStr, origin.endsWith("/") ? origin : origin + "/");

  // Forward query params (except "origin")
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== "origin") {
      targetUrl.searchParams.set(key, value);
    }
  });

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent":
          request.headers.get("user-agent") ?? "Mozilla/5.0",
        Accept: request.headers.get("accept") ?? "*/*",
        "Accept-Language":
          request.headers.get("accept-language") ?? "en-US,en;q=0.5",
        "Accept-Encoding": "identity",
        Referer: origin,
        Origin: origin,
      },
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") ?? "";

    // Non-HTML responses: pass through as-is
    if (!contentType.includes("text/html")) {
      const body = await response.arrayBuffer();
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      // Forward cache headers
      const cacheControl = response.headers.get("cache-control");
      if (cacheControl) headers.set("Cache-Control", cacheControl);
      return new NextResponse(body, { status: response.status, headers });
    }

    // HTML response: inject wallet script + base tag
    let html = await response.text();

    // Base tag so relative <script>, <link>, <img> resolve to the dApp's real origin.
    // This doesn't affect fetch() calls, but those typically use absolute URLs.
    const baseTag = `<base href="${origin}/">`;

    // Inject base tag + wallet script at the very beginning of <head>
    const headPattern = /<head[^>]*>/i;
    if (headPattern.test(html)) {
      html = html.replace(
        headPattern,
        (match) => `${match}${baseTag}${WALLET_INJECT_SCRIPT}`
      );
    } else {
      html = baseTag + WALLET_INJECT_SCRIPT + html;
    }

    // Remove CSP meta tags that might block our injected script
    html = html.replace(
      /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
      ""
    );

    return new NextResponse(html, {
      status: response.status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}

// Also handle POST requests (for API calls the dApp makes)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const origin = request.nextUrl.searchParams.get("origin");

  if (!origin) {
    return NextResponse.json(
      { error: "Missing origin query parameter" },
      { status: 400 }
    );
  }

  const pathStr = path?.join("/") ?? "";
  const targetUrl = new URL(pathStr, origin.endsWith("/") ? origin : origin + "/");

  request.nextUrl.searchParams.forEach((value, key) => {
    if (key !== "origin") {
      targetUrl.searchParams.set(key, value);
    }
  });

  try {
    const body = await request.arrayBuffer();
    const response = await fetch(targetUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/json",
        "User-Agent": request.headers.get("user-agent") ?? "Mozilla/5.0",
        Referer: origin,
        Origin: origin,
      },
      body,
      redirect: "follow",
    });

    const responseBody = await response.arrayBuffer();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}
