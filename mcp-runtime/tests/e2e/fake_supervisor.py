"""Test-only stand-in for the two Supervisor surfaces the built-in MCP server touches (never production).

Runs at 172.30.32.2 with the network alias `supervisor` on a throwaway Docker network, so that:
- ws://supervisor/core/websocket answers the vendored HA admin-role verifier (mcp_admin_core/ha_role.py) like the
  Supervisor Core WebSocket proxy: auth_required -> auth (the container's throwaway SUPERVISOR_TOKEN) -> auth_ok
  -> config/auth/list with one administrator and one ordinary user;
- requests sent from this container to the add-on's port 8099 come from the Ingress peer address.

Env: FAKE_SUPERVISOR_TOKEN (throwaway, generated inside the VM), FAKE_ADMIN_ID, FAKE_USER_ID.
"""
import asyncio
import json
import os

from websockets.asyncio.server import serve

HA_VERSION = '2026.10.1'  # one of the verifier's reviewed Core versions


async def handler(socket):
    if socket.request.path != '/core/websocket':
        await socket.close()
        return
    await socket.send(json.dumps({'type': 'auth_required', 'ha_version': HA_VERSION}))
    auth = json.loads(await socket.recv())
    if auth.get('type') != 'auth' or auth.get('access_token') != os.environ['FAKE_SUPERVISOR_TOKEN']:
        await socket.send(json.dumps({'type': 'auth_invalid', 'message': 'invalid'}))
        await socket.close()
        return
    await socket.send(json.dumps({'type': 'auth_ok', 'ha_version': HA_VERSION}))
    request = json.loads(await socket.recv())
    users = [
        {'id': os.environ['FAKE_ADMIN_ID'], 'is_active': True, 'is_owner': False, 'system_generated': False,
         'group_ids': ['system-admin'], 'local_only': False},
        {'id': os.environ['FAKE_USER_ID'], 'is_active': True, 'is_owner': False, 'system_generated': False,
         'group_ids': ['system-users'], 'local_only': False},
    ]
    await socket.send(json.dumps({'id': request.get('id'), 'type': 'result', 'success': True, 'result': users}))


async def main():
    async with serve(handler, '0.0.0.0', 80):
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
