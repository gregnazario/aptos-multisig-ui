export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getAdminAddresses } = await import("@/lib/auth/admin");
  const admins = getAdminAddresses();
  if (admins.length === 0) {
    console.log(
      "[admin] APTOS_ADMIN_ADDRESSES is empty; only multisig signers can create proposals.",
    );
  } else {
    console.log(
      `[admin] Loaded ${admins.length} admin address${admins.length === 1 ? "" : "es"}:`,
    );
    for (const addr of admins) console.log(`  - ${addr}`);
  }
}
