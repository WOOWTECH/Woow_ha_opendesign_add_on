import test from 'node:test';
import assert from 'node:assert/strict';
import {assertListeners, baseListeners, parseListeners} from './listener-contract.mjs';
const managed = port => ({running:true, state:{port}, config:{daemon:{listen:`127.0.0.1:${port}`}}});
test('settled runtime permits exactly its recorded loopback listener, including port fallback', () => {
  for (const port of [6769, 6770, 24680]) assertListeners([...baseListeners,`127.0.0.1:${port}`],managed(port));
  assertListeners(baseListeners, {running:false});
});
test('rejects all new public, IPv6, unrecorded, duplicate and missing listeners', () => {
  const good=[...baseListeners,'127.0.0.1:6769'];
  for(const extra of ['0.0.0.0:6769',':::6769','127.0.0.1:7460','127.0.0.1:6769'])
    assert.throws(()=>assertListeners([...good,extra],managed(6769)));
  assert.throws(()=>assertListeners(baseListeners,managed(6769)));
  assert.throws(()=>assertListeners(good,{running:false}));
  assert.throws(()=>assertListeners(good,managed(6770)));
  assert.throws(()=>assertListeners(good,{...managed(6769),config:{daemon:{listen:'0.0.0.0:6769'}}}));
  assert.throws(()=>assertListeners(good,{...managed(6769),state:{port:'6769'}}));
  assert.throws(()=>assertListeners(baseListeners,managed(7456)));
});
test('parses BusyBox netstat TCP4 and TCP6 without discarding unexpected listeners', () => {
  assert.deepEqual(parseListeners('Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address Foreign Address State\ntcp 0 0 127.0.0.1:6769 0.0.0.0:* LISTEN\ntcp6 0 0 :::1234 :::* LISTEN\n'),['127.0.0.1:6769',':::1234']);
});
