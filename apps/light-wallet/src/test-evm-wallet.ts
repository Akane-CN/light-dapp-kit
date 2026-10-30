import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";

/**
 * A minimal EIP-1193 + EIP-6963 wallet backed by a fixed Ethereum private key, for e2e tests
 * only. It lets the test drive the real CCC connector UI (which discovers EVM wallets via
 * EIP-6963) end to end — selection, EVM signer, Omnilock address, personal_sign — without a
 * browser extension or a human. Loaded only when the app is built with VITE_ALLOW_TEST_SIGNER=1
 * and `window.__ETH_TEST_KEY` is set, so production bundles never include it.
 */

const hex = (b: Uint8Array) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (s: string) => {
  const h = s.startsWith("0x") ? s.slice(2) : s;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const isHex = (s: string) => /^0x[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0;

function ethAddress(priv: Uint8Array): string {
  const pub = secp256k1.getPublicKey(priv, false).slice(1); // drop the 0x04 prefix
  return hex(keccak_256(pub).slice(-20));
}

/** EIP-191 personal_sign: keccak256("\x19Ethereum Signed Message:\n" + len + message). */
function personalSign(priv: Uint8Array, message: string): string {
  const bytes = isHex(message) ? fromHex(message) : new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const digest = keccak_256(new Uint8Array([...prefix, ...bytes]));
  const sig = secp256k1.sign(digest, priv); // low-S by default
  const v = 27 + sig.recovery;
  return hex(sig.toCompactRawBytes()) + v.toString(16).padStart(2, "0");
}

interface Eip1193Request {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

function makeProvider(privHex: string) {
  const priv = fromHex(privHex);
  const address = ethAddress(priv);
  return {
    isLightDappTestWallet: true,
    async request(req: Eip1193Request): Promise<unknown> {
      switch (req.method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [address];
        case "eth_chainId":
          return "0x1";
        case "personal_sign": {
          const [a, b] = (req.params as string[]) ?? [];
          // personal_sign params are [message, address]; tolerate the reverse order too.
          const message = a?.toLowerCase() === address.toLowerCase() ? b : a;
          return personalSign(priv, message);
        }
        default:
          throw Object.assign(new Error(`unsupported method ${req.method}`), { code: 4200 });
      }
    },
    on() { return this; },
    removeListener() { return this; },
  };
}

/** Announce the test wallet over EIP-6963 so the CCC connector lists it. */
export function registerTestEvmWallet(privHex: string): string {
  const provider = makeProvider(privHex);
  const info = {
    uuid: "11111111-2222-3333-4444-555555555555",
    name: "Light dApp Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    rdns: "kit.light-dapp.test",
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  return info.name;
}
