"""MCP client probe for the built-in OpenDesign MCP server (test-only; prints results, never the token).

usage: MCP_TOKEN=... python mcp_probe.py <base-url> <check> [...]
checks:
  auth      no/wrong Bearer -> 401; Bearer + Origin -> 403
  bearer    initialize -> initialized -> tools/list -> tools/call health, version, list_projects, list_agents (Bearer)
  secret    the same over /private_<token>/mcp with an Origin header (Claude.ai style); wrong secret -> 404
  tools     only print the tools/list names (Bearer)
  health    initialize + tools/call health only (Bearer); exit 0 even if the tool reports an error
  status    HTTP status of a Bearer initialize only (token lifecycle checks)
  ready     GET /health/ready
Outputs one JSON line per check. The token comes only from MCP_TOKEN and is redacted from all output.
"""
import json
import os
import sys

import httpx

TOKEN = os.environ.get('MCP_TOKEN', '')
ACCEPT = 'application/json, text/event-stream'
PROTOCOL = '2025-06-18'


def redact(text):
    return text.replace(TOKEN, '[REDACTED]') if TOKEN else text


def out(**fields):
    print(redact(json.dumps(fields, ensure_ascii=False, sort_keys=True)), flush=True)


def rpc_result(response):
    """Parse a JSON or SSE reply into the JSON-RPC message."""
    media = response.headers.get('content-type', '').split(';')[0]
    if media == 'text/event-stream':
        for event in response.text.split('\n\n'):
            data = '\n'.join(line[5:].lstrip() for line in event.splitlines() if line.startswith('data:'))
            if data.strip():
                return json.loads(data)
        raise ValueError('no SSE data')
    return response.json()


class Session:
    def __init__(self, client, url, headers):
        self.client, self.url, self.headers, self.next_id = client, url, dict(headers), 1

    def post(self, message, extra=None):
        headers = {'Accept': ACCEPT, 'Content-Type': 'application/json', **self.headers, **(extra or {})}
        return self.client.post(self.url, headers=headers, content=json.dumps(message))

    def request(self, method, params=None):
        message = {'jsonrpc': '2.0', 'id': self.next_id, 'method': method}
        if params is not None:
            message['params'] = params
        self.next_id += 1
        response = self.post(message)
        response.raise_for_status()
        return rpc_result(response)

    def initialize(self):
        response = self.post({'jsonrpc': '2.0', 'id': 0, 'method': 'initialize', 'params': {
            'protocolVersion': PROTOCOL, 'capabilities': {}, 'clientInfo': {'name': 'team-ha-mcp-probe', 'version': '0'}}})
        response.raise_for_status()
        result = rpc_result(response)['result']
        self.headers['mcp-session-id'] = response.headers['mcp-session-id']
        self.headers['mcp-protocol-version'] = result['protocolVersion']
        note = self.post({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        return result, note.status_code

    def call(self, name, arguments=None):
        reply = self.request('tools/call', {'name': name, 'arguments': arguments or {}})
        result = reply.get('result') or {}
        text = ''.join(item.get('text', '') for item in result.get('content', []) if item.get('type') == 'text')
        return {'isError': bool(result.get('isError')), 'error': reply.get('error'), 'text': text[:400]}

    def close(self):
        self.client.delete(self.url, headers=self.headers)


def flow(client, url, headers, label):
    session = Session(client, url, headers)
    result, initialized = session.initialize()
    out(check=label, step='initialize', serverInfo=result.get('serverInfo'), protocolVersion=result.get('protocolVersion'),
        capabilities=result.get('capabilities'), initialized_status=initialized)
    tools = session.request('tools/list')['result']['tools']
    out(check=label, step='tools/list', count=len(tools), names=sorted(t['name'] for t in tools),
        read_only_hints=sorted(t['name'] for t in tools if (t.get('annotations') or {}).get('readOnlyHint') is True))
    for name in ('health', 'version', 'list_projects', 'list_agents'):
        out(check=label, step='tools/call ' + name, **session.call(name))
    session.close()


def main():
    base, checks = sys.argv[1].rstrip('/'), sys.argv[2:]
    with httpx.Client(timeout=httpx.Timeout(40, connect=5), trust_env=False) as client:
        bearer = {'Authorization': 'Bearer ' + TOKEN}
        init = {'jsonrpc': '2.0', 'id': 0, 'method': 'initialize', 'params': {
            'protocolVersion': PROTOCOL, 'capabilities': {}, 'clientInfo': {'name': 'probe', 'version': '0'}}}
        for check in checks:
            if check == 'auth':
                s = Session(client, base + '/mcp', {})
                r = s.post(init)
                out(check='auth', case='no Authorization', status=r.status_code, www_authenticate=r.headers.get('www-authenticate'))
                r = s.post(init, {'Authorization': 'Bearer wrong-' + 'x' * 38})
                out(check='auth', case='wrong Bearer', status=r.status_code)
                r = s.post(init, {**bearer, 'Origin': 'https://example.invalid'})
                out(check='auth', case='Bearer + Origin', status=r.status_code)
            elif check == 'bearer':
                flow(client, base + '/mcp', bearer, 'bearer')
            elif check == 'secret':
                flow(client, base + '/private_' + TOKEN + '/mcp', {'Origin': 'https://claude.ai'}, 'secret')
                r = Session(client, base + '/private_' + 'y' * 43 + '/mcp', {'Origin': 'https://claude.ai'}).post(init)
                out(check='secret', case='wrong secret', status=r.status_code)
            elif check == 'tools':
                session = Session(client, base + '/mcp', bearer)
                session.initialize()
                tools = session.request('tools/list')['result']['tools']
                out(check='tools', count=len(tools), names=sorted(t['name'] for t in tools))
                session.close()
            elif check == 'health':
                session = Session(client, base + '/mcp', bearer)
                session.initialize()
                out(check='health', **session.call('health'))
                session.close()
            elif check == 'status':
                r = Session(client, base + '/mcp', bearer).post(init)
                out(check='status', case='Bearer initialize', status=r.status_code)
            elif check == 'ready':
                r = client.get(base + '/health/ready')
                out(check='ready', status=r.status_code, body=r.text[:200])
            else:
                raise SystemExit('unknown check ' + check)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # report, without the token, and fail
        out(error=type(exc).__name__, detail=str(exc)[:300])
        raise SystemExit(1)
