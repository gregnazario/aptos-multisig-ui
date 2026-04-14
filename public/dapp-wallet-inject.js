/**
 * dapp-wallet-inject.js
 *
 * Vanilla JS script intended to be injected into dApp iframes to intercept
 * Aptos wallet calls and relay them to the parent multisig UI via postMessage.
 *
 * KNOWN LIMITATION: Cross-origin iframe injection is not straightforward.
 * This script cannot be automatically injected into a cross-origin iframe due
 * to browser security policies. For the MVP, this works only if:
 *   1. The dApp does not block framing (no X-Frame-Options / CSP frame-ancestors), AND
 *   2. The script is somehow loaded into the iframe context (e.g. via a proxy).
 * A production solution would require a server-side HTML proxy that rewrites
 * the dApp's HTML to include this script, but that is beyond MVP scope.
 */
(function () {
  let resolvers = {};
  let requestId = 0;

  window.addEventListener("message", (event) => {
    if (event.data?.type === "MULTISIG_WALLET_RESPONSE") {
      const { id, result, error } = event.data;
      const resolver = resolvers[id];
      if (resolver) {
        if (error) resolver.reject(new Error(error));
        else resolver.resolve(result);
        delete resolvers[id];
      }
    }
  });

  function sendToParent(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      resolvers[id] = { resolve, reject };
      window.parent.postMessage(
        { type: "MULTISIG_WALLET_REQUEST", id, method, params },
        "*"
      );
    });
  }

  window.aptos = {
    connect: () => sendToParent("connect", {}),
    disconnect: () => sendToParent("disconnect", {}),
    account: () => sendToParent("account", {}),
    network: () => sendToParent("network", {}),
    signMessage: (payload) => sendToParent("signMessage", payload),
    signTransaction: (payload) => sendToParent("signTransaction", payload),
    signAndSubmitTransaction: (payload) =>
      sendToParent("signAndSubmitTransaction", payload),
    onAccountChange: () => {},
    onNetworkChange: () => {},
    isConnected: () => sendToParent("isConnected", {}),
  };

  window.dispatchEvent(new Event("aptos:wallet:ready"));
})();
