#!/usr/bin/env node
// A throwaway validator key for the upgrade test (scripts/ci/upgrade-test.sh):
// a new random BLS12-381 secret key on every run, in an EIP-2335 keystore
// (PBKDF2-SHA256, AES-128-CTR) with a random password. A fixed test key would
// have a public secret, and one deposit to it (1 GNO on Gnosis) would turn it
// into a real validator and make every later upgrade test fail; a new key per
// run leaves nothing to deposit to.
//
//   node test-keystore.mjs         prints {"keystore": {...}, "password": "...", "pubkey": "0x..."}
//
// Node 18 or later (the package image's own node runs it), no dependencies:
// node:crypto for the keystore, BigInt for the public key (secret key times the
// G1 generator, compressed as in the Ethereum consensus specs). The unit test
// (.github/pipeline/test) checks both against the EIP-2335 PBKDF2 test vector.

import { randomBytes, randomUUID, pbkdf2Sync, createCipheriv, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// BLS12-381: the base field, the group order and the G1 generator (curve y^2 = x^3 + 4).
const P = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const R = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const G = [
  0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bbn,
  0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1n,
];

const mod = (a) => ((a % P) + P) % P;
function powMod(b, e) {
  let r = 1n;
  b = mod(b);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return r;
}
const inv = (a) => powMod(a, P - 2n);

// Affine points; null is the point at infinity.
function add(p, q) {
  if (!p) return q;
  if (!q) return p;
  let l;
  if (p[0] === q[0]) {
    if (mod(p[1] + q[1]) === 0n) return null;
    l = mod(3n * p[0] * p[0] * inv(2n * p[1]));
  } else {
    l = mod((q[1] - p[1]) * inv(q[0] - p[0]));
  }
  const x = mod(l * l - p[0] - q[0]);
  return [x, mod(l * (p[0] - x) - p[1])];
}

const toHex = (n, bytes) => n.toString(16).padStart(bytes * 2, '0');

// The compressed G1 public key of a secret key (1 <= sk < r), 48 bytes as hex.
export function publicKey(sk) {
  if (sk <= 0n || sk >= R) throw new Error('secret key out of range');
  let acc = null;
  let base = G;
  for (let k = sk; k > 0n; k >>= 1n) {
    if (k & 1n) acc = add(acc, base);
    base = add(base, base);
  }
  const [x, y] = acc;
  if (mod(y * y - x * x * x - 4n) !== 0n) throw new Error('not on the curve');
  const out = Buffer.from(toHex(x, 48), 'hex');
  out[0] |= 0x80; // compressed
  if (y > (P - 1n) / 2n) out[0] |= 0x20; // the larger y
  return out.toString('hex');
}

// EIP-2335 keystore of a secret key. password: the password as it is used
// (EIP-2335 normalises it first: NFKD, control characters removed).
export function keystore({ sk, password, salt, iv, uuid, c = 262144, path = '' }) {
  const secret = Buffer.from(toHex(sk, 32), 'hex');
  const dk = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, c, 32, 'sha256');
  const cipher = createCipheriv('aes-128-ctr', dk.subarray(0, 16), iv);
  const message = Buffer.concat([cipher.update(secret), cipher.final()]);
  const checksum = createHash('sha256').update(Buffer.concat([dk.subarray(16, 32), message])).digest('hex');
  return {
    crypto: {
      kdf: { function: 'pbkdf2', params: { dklen: 32, c, prf: 'hmac-sha256', salt: salt.toString('hex') }, message: '' },
      checksum: { function: 'sha256', params: {}, message: checksum },
      cipher: { function: 'aes-128-ctr', params: { iv: iv.toString('hex') }, message: message.toString('hex') },
    },
    description: 'AVADO upgrade test: a throwaway key made for one CI run',
    pubkey: publicKey(sk),
    path,
    uuid,
    version: 4,
  };
}

export function randomKey() {
  let sk = 0n;
  while (sk === 0n) sk = BigInt(`0x${randomBytes(48).toString('hex')}`) % R;
  const password = randomBytes(16).toString('hex');
  const ks = keystore({ sk, password, salt: randomBytes(32), iv: randomBytes(16), uuid: randomUUID() });
  return { keystore: ks, password, pubkey: `0x${ks.pubkey}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(randomKey())}\n`);
}
