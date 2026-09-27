// Unit tests for the upgrade test's throwaway validator key (scripts/ci/test-keystore.mjs):
// node --test ".github/pipeline/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicKey, keystore, randomKey } from '../../../scripts/ci/test-keystore.mjs';

test('the upgrade test key: a new random key per run, public key and keystore as the EIP-2335 test vector says', () => {
  // EIP-2335 PBKDF2 test vector (password "𝔱𝔢𝔰𝔱𝔭𝔞𝔰𝔰𝔴𝔬𝔯𝔡🔑" after normalisation).
  const sk = 0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26fn;
  const ks = keystore({
    sk, password: 'testpassword\u{1F511}', uuid: '64625def-3331-4eea-ab6f-782f3ed16a83',
    salt: Buffer.from('d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3', 'hex'),
    iv: Buffer.from('264daa3f303d7259501c93d997d84fe6', 'hex'),
  });
  assert.equal(ks.pubkey, '9612d7a727c9d0a22e185a1c768478dfe919cada9266988cb32359c11f2b7b27f4ae4040902382ae2910c15e2b420d07');
  assert.equal(ks.crypto.checksum.message, '8a9f5d9912ed7e75ea794bc5a89bca5f193721d30868ade6f73043c6ea6febf1');
  assert.equal(ks.crypto.cipher.message, 'cee03fde2af33149775b7223e7845e4fb2c8ae1792e5f99fe9ecf474cc8c16ad');
  assert.deepEqual(ks.crypto.kdf.params, { dklen: 32, c: 262144, prf: 'hmac-sha256', salt: 'd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3' });
  // The G1 generator and its negation (the sign flag of the larger y).
  const g = '97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb';
  assert.equal(publicKey(1n), g);
  const r = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
  assert.equal(publicKey(r - 1n), `b7${g.slice(2)}`);
  assert.throws(() => publicKey(0n));
  const a = randomKey();
  const b = randomKey();
  assert.match(a.pubkey, /^0x[89ab][0-9a-f]{95}$/);
  assert.notEqual(a.pubkey, b.pubkey, 'a new key every time');
  assert.notEqual(a.password, b.password);
  assert.equal(`0x${a.keystore.pubkey}`, a.pubkey);
});
