// Stand-ins for the parts of an AVADO box the Teku package talks to, for the
// boot test (scripts/ci/boot-test.sh). Runs with the node inside the Teku image.
//
//   port 80   dappmanager.my.ava.do/jwttoken.txt  -> a JWT secret (like the DAPPMANAGER)
//   port 8551 the execution engine API            -> answers like an execution
//             client that is still syncing: every payload is SYNCING, so Teku
//             follows the chain optimistically, the way it does on a new box
//             while its execution client syncs.
//
// No real execution client runs on a GitHub runner (disk, time), so the boot
// test proves checkpoint sync, peering, the chain head moving and a clean
// start with the package's real command line, not block execution.
'use strict';
const http = require('http');

const JWT = '0x' + '0f'.repeat(32);
const seen = new Map();

function reply(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// The DAPPMANAGER also serves the *.my.ava.do certificate, which reload-certs.sh
// fetches; serving the copy baked into this image (the stand-in runs from the
// same image) means "no restart needed", as on a box with a current image.
const fs = require('fs');
const CERTS = { '/my.ava.do.crt': '/opt/teku/my.ava.do.crt', '/my.ava.do.key': '/opt/teku/my.ava.do.key' };

http.createServer((req, res) => {
  if (req.url === '/jwttoken.txt') return reply(res, 200, JWT, 'text/plain');
  if (CERTS[req.url] && fs.existsSync(CERTS[req.url])) return reply(res, 200, fs.readFileSync(CERTS[req.url]), 'application/octet-stream');
  reply(res, 404, 'not found', 'text/plain');
}).listen(80, () => console.log('boot-mock: dappmanager on :80'));

const SYNCING = { status: 'SYNCING', latestValidHash: null, validationError: null };

function answer(method, params) {
  if (/^engine_newPayloadV\d+$/.test(method)) return SYNCING;
  if (/^engine_forkchoiceUpdatedV\d+$/.test(method)) return { payloadStatus: SYNCING, payloadId: null };
  if (method === 'engine_exchangeCapabilities') {
    // Everything Teku asks for except the blob and payload-building calls.
    return (params && params[0] || []).filter((m) => !/^engine_(getBlobs|getPayload)/.test(m));
  }
  if (method === 'engine_getClientVersionV1') return [{ code: 'XX', name: 'avado-boot-mock', version: '0.0.0', commit: '0x00000000' }];
  if (method === 'eth_syncing') return { startingBlock: '0x0', currentBlock: '0x0', highestBlock: '0x1' };
  if (method === 'eth_chainId') return process.env.CHAIN_ID || '0x1';
  return undefined;
}

http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    if (req.method !== 'POST') return reply(res, 405, 'engine API mock', 'text/plain');
    let msg;
    try { msg = JSON.parse(data); } catch { return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    const one = (m) => {
      seen.set(m.method, (seen.get(m.method) || 0) + 1);
      const result = answer(m.method, m.params);
      return result === undefined
        ? { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method ${m.method} not supported by the boot-test mock` } }
        : { jsonrpc: '2.0', id: m.id, result };
    };
    reply(res, 200, Array.isArray(msg) ? msg.map(one) : one(msg));
  });
}).listen(8551, () => console.log('boot-mock: engine API on :8551'));

setInterval(() => console.log('boot-mock: engine calls ' + JSON.stringify(Object.fromEntries(seen))), 60000);
