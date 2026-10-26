import assert from 'node:assert/strict';

export const baseListeners = ['0.0.0.0:8081', '0.0.0.0:8099', '127.0.0.1:7456', '127.0.0.1:7681'];
export function assertListeners(actual, {running, state, config} = {running: false}) {
  const expected = [...baseListeners];
  if (running) {
    assert.ok(Number.isInteger(state?.port) && state.port >= 1024 && state.port <= 65535, 'missing managed port');
    const listen = `127.0.0.1:${state.port}`;
    assert.equal(config?.daemon?.listen, listen, 'managed daemon must bind its recorded IPv4 loopback port');
    assert.ok(!expected.includes(listen), 'managed port overlaps a required service');
    expected.push(listen);
  }
  assert.deepEqual([...actual].sort(), expected.sort(), 'unexpected or missing TCP listeners');
}
export function parseListeners(netstat) {
  return netstat.split('\n').filter(line => /\bLISTEN\s*$/.test(line)).map(line => line.trim().split(/\s+/)[3]);
}
