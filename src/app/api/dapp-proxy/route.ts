import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side HTML proxy for the dApp browser.
 * Fetches the target dApp's HTML, injects our wallet script into <head>,
 * and serves it from our origin so the script runs in the iframe context.
 *
 * Subresources (JS, CSS, images) are loaded directly from the dApp's origin
 * since we rewrite relative URLs to absolute.
 */
export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": request.headers.get("user-agent") ?? "",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": request.headers.get("accept-language") ?? "en-US,en;q=0.5",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch: ${response.status} ${response.statusText}` },
        { status: 502 }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      // Not HTML — proxy the raw response (for sub-resource requests)
      const body = await response.arrayBuffer();
      return new NextResponse(body, {
        headers: { "Content-Type": contentType },
      });
    }

    let html = await response.text();
    const origin = parsedUrl.origin;

    // Add <base> tag so relative URLs resolve to the dApp's origin
    const baseTag = `<base href="${origin}/">`;

    // Build the wallet inject script with parent communication
    const injectScript = `
<script data-multisig-wallet-inject="true">
${getWalletInjectScript()}
</script>`;

    // Inject into <head> — insert our script + base tag at the very beginning
    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>${baseTag}${injectScript}`);
    } else if (html.includes("<HEAD>")) {
      html = html.replace("<HEAD>", `<HEAD>${baseTag}${injectScript}`);
    } else {
      // No head tag — prepend
      html = `${baseTag}${injectScript}${html}`;
    }

    // Remove any existing CSP meta tags that might block our script
    html = html.replace(
      /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
      ""
    );

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Allow the iframe to load this
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}

function getWalletInjectScript(): string {
  return `
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

  // ── Cached state from parent ────────────────────────────────────────
  var cachedAccount = null;
  var cachedNetwork = null;
  var accountChangeCallbacks = [];
  var networkChangeCallbacks = [];

  // Pre-fetch account and network info from parent
  sendToParent("account", {}).then(function(acc) { cachedAccount = acc; });
  sendToParent("network", {}).then(function(net) { cachedNetwork = net; });

  // ── Legacy window.aptos override ────────────────────────────────────
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
  // Minimal SVG icon as data URI
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
            cachedAccount = acc;
            var account = makeAccount(acc);
            wallet.accounts = [account];
            return { status: "Approved", args: acc };
          });
        },
      },

      "aptos:account": {
        version: "1.0.0",
        account: function() {
          return sendToParent("account", {}).then(function(acc) {
            cachedAccount = acc;
            return acc;
          });
        },
      },

      "aptos:network": {
        version: "1.0.0",
        network: function() {
          return sendToParent("network", {}).then(function(net) {
            cachedNetwork = net;
            return net;
          });
        },
      },

      "aptos:signTransaction": {
        version: "1.1.0",
        signTransaction: function(input) {
          return sendToParent("signTransaction", input);
        },
      },

      "aptos:signAndSubmitTransaction": {
        version: "1.0.0",
        signAndSubmitTransaction: function(input) {
          return sendToParent("signAndSubmitTransaction", input);
        },
      },

      "aptos:signMessage": {
        version: "1.0.0",
        signMessage: function(input) {
          return sendToParent("signMessage", input);
        },
      },

      "aptos:onAccountChange": {
        version: "1.0.0",
        onAccountChange: function(callback) {
          accountChangeCallbacks.push(callback);
        },
      },

      "aptos:onNetworkChange": {
        version: "1.0.0",
        onNetworkChange: function(callback) {
          networkChangeCallbacks.push(callback);
        },
      },

      "aptos:disconnect": {
        version: "1.0.0",
        disconnect: function() {
          wallet.accounts = [];
          cachedAccount = null;
          return Promise.resolve();
        },
      },

      "aptos:changeNetwork": {
        version: "1.0.0",
        changeNetwork: function(networkInfo) {
          return sendToParent("changeNetwork", networkInfo);
        },
      },
    },
  };

  // Also expose features at top level for adapters that check both ways
  Object.keys(wallet.features).forEach(function(key) {
    wallet[key] = wallet.features[key];
  });

  function makeAccount(acc) {
    return {
      address: acc.address || "",
      publicKey: new Uint8Array(32),
      chains: ["aptos:mainnet", "aptos:testnet", "aptos:devnet"],
      features: Object.keys(wallet.features),
    };
  }

  // ── Register via wallet-standard events ─────────────────────────────
  function registerWallet() {
    // Method 1: Dispatch register event (wallet tells dApp it exists)
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
        bubbles: false,
        cancelable: false,
        detail: function(api) { api.register(wallet); },
      }));
    } catch(e) { console.warn("[MultisigWallet] register-wallet event failed:", e); }

    // Method 2: Listen for app-ready (dApp asks wallets to register)
    window.addEventListener("wallet-standard:app-ready", function(e) {
      try {
        if (e.detail && typeof e.detail.register === "function") {
          e.detail.register(wallet);
        }
      } catch(err) { console.warn("[MultisigWallet] app-ready handler failed:", err); }
    });

    // Method 3: Legacy navigator.wallets
    try {
      if (!window.navigator.wallets) window.navigator.wallets = [];
      if (Array.isArray(window.navigator.wallets)) {
        window.navigator.wallets.push(function(api) { api.register(wallet); });
      }
    } catch(e) { /* ignore */ }
  }

  // Register immediately (script runs in <head> before dApp code)
  registerWallet();

  console.log("[MultisigWallet] AIP-62 wallet registered:", WALLET_NAME);
})();
`;
}
