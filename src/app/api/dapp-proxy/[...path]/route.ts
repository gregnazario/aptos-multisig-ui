import { type NextRequest, NextResponse } from "next/server";

/**
 * Full reverse proxy for the dApp browser.
 *
 * Usage: /api/dapp-proxy/{path}?origin=https://app.ariesmarkets.xyz
 *
 * - Proxies the initial HTML page from the target origin
 * - Injects a wallet script + fetch/XHR interceptor into HTML responses
 * - The <base> tag handles HTML element URLs (script src, link href, img src)
 * - The fetch/XHR interceptor handles JS API calls (fetch, XMLHttpRequest)
 * - Non-HTML sub-resources are proxied through for cases where <base> isn't enough
 */

function buildWalletInjectScript(dappOrigin: string): string {
  return `
<script data-multisig-wallet-inject="true">
(function() {
  'use strict';
  var DAPP_ORIGIN = ${JSON.stringify(dappOrigin)};

  // ── Rewrite relative URLs to the dApp origin ───────────────────────
  // <base href> handles HTML elements, but fetch()/XHR use window.location.
  // Override both to redirect relative URLs to the real dApp origin.

  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === "string" && input.startsWith("/")) {
      input = DAPP_ORIGIN + input;
    } else if (input instanceof Request && input.url.startsWith(window.location.origin)) {
      var newUrl = input.url.replace(window.location.origin, DAPP_ORIGIN);
      input = new Request(newUrl, input);
    }
    return originalFetch.call(this, input, init);
  };

  var origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === "string" && url.startsWith("/")) {
      url = DAPP_ORIGIN + url;
    }
    return origXHROpen.apply(this, arguments);
  };

  // Also handle dynamic import() by overriding the importmap or using a
  // service worker in the future. For now, <base href> handles static imports.

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
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
        bubbles: false, cancelable: false,
        detail: function(api) { api.register(wallet); },
      }));
    } catch(e) {}

    window.addEventListener("wallet-standard:app-ready", function(e) {
      try { if (e.detail && typeof e.detail.register === "function") e.detail.register(wallet); } catch(e) {}
    });

    try {
      if (!window.navigator.wallets) window.navigator.wallets = [];
      if (Array.isArray(window.navigator.wallets)) {
        window.navigator.wallets.push(function(api) { api.register(wallet); });
      }
    } catch(e) {}
  }

  registerWallet();
  console.log("[MultisigWallet] AIP-62 wallet registered, fetch/XHR intercepted -> " + DAPP_ORIGIN);
})();
</script>`;
}

/**
 * Proxy a request to the target origin, forwarding common headers.
 */
async function proxyFetch(
  targetUrl: string,
  request: NextRequest,
  origin: string,
  method: string = "GET",
  body?: ArrayBuffer,
): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": request.headers.get("user-agent") ?? "Mozilla/5.0",
    Accept: request.headers.get("accept") ?? "*/*",
    "Accept-Language":
      request.headers.get("accept-language") ?? "en-US,en;q=0.5",
    "Accept-Encoding": "identity",
    Referer: origin,
    Origin: origin,
  };

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    headers["Content-Type"] =
      request.headers.get("content-type") ?? "application/json";
  }

  return fetch(targetUrl, {
    method,
    headers,
    body: body ?? undefined,
    redirect: "follow",
  });
}

function buildTargetUrl(
  path: string[],
  origin: string,
  searchParams: URLSearchParams,
): string {
  const pathStr = path?.join("/") ?? "";
  const targetUrl = new URL(
    pathStr,
    origin.endsWith("/") ? origin : `${origin}/`,
  );

  searchParams.forEach((value, key) => {
    if (key !== "origin") {
      targetUrl.searchParams.set(key, value);
    }
  });

  return targetUrl.toString();
}

async function handleProxyResponse(
  response: Response,
  origin: string,
  _isInitialPage: boolean,
): Promise<NextResponse> {
  const contentType = response.headers.get("content-type") ?? "";

  // Non-HTML: pass through as-is
  if (!contentType.includes("text/html")) {
    const body = await response.arrayBuffer();
    const headers = new Headers();
    headers.set("Content-Type", contentType);

    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) headers.set("Cache-Control", cacheControl);

    // Forward CORS headers for sub-resources
    headers.set("Access-Control-Allow-Origin", "*");

    return new NextResponse(body, { status: response.status, headers });
  }

  // HTML: inject base tag + wallet script + fetch interceptor
  let html = await response.text();

  const baseTag = `<base href="${origin}/">`;
  const injectScript = buildWalletInjectScript(origin);

  const headPattern = /<head[^>]*>/i;
  if (headPattern.test(html)) {
    html = html.replace(
      headPattern,
      (match) => `${match}${baseTag}${injectScript}`,
    );
  } else {
    html = `<!DOCTYPE html><html><head>${baseTag}${injectScript}</head>${html}`;
  }

  // Remove CSP meta tags that block our script
  html = html.replace(
    /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi,
    "",
  );

  return new NextResponse(html, {
    status: response.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const origin = request.nextUrl.searchParams.get("origin");

  if (!origin) {
    return NextResponse.json(
      { error: "Missing origin query parameter" },
      { status: 400 },
    );
  }

  const targetUrl = buildTargetUrl(path, origin, request.nextUrl.searchParams);
  const isInitialPage = !path || path.length === 0 || path[0] === "";

  try {
    const response = await proxyFetch(targetUrl, request, origin);
    return handleProxyResponse(response, origin, isInitialPage);
  } catch (err) {
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const origin = request.nextUrl.searchParams.get("origin");

  if (!origin) {
    return NextResponse.json(
      { error: "Missing origin query parameter" },
      { status: 400 },
    );
  }

  const targetUrl = buildTargetUrl(path, origin, request.nextUrl.searchParams);

  try {
    const body = await request.arrayBuffer();
    const response = await proxyFetch(targetUrl, request, origin, "POST", body);

    const responseBody = await response.arrayBuffer();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Proxy error: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
