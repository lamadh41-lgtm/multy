#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
مضيف Story Mode — HTTP + WebSocket على نفس المنفذ.
WebSocket (/ws) = تزامن فوري على LAN بدون polling.

  python lan_host.py
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
import json
import threading
import time
import socket
import os
import mimetypes
import hashlib
import base64
import struct
import select

PORT = int(os.environ.get('STORY_PORT', '27100'))
ROOT = os.path.dirname(os.path.abspath(__file__))
ROOMS = {}
# room -> list of WsClient
WS_ROOMS = {}
LOCK = threading.Lock()
MAX_MSG = 200
MAX_POSE_PLAYERS = 24
HOST_TIMEOUT = 50.0
ROOM_TTL = 30 * 60
ROOM_GRACE = 10.0

WS_GUID = b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


def local_ips():
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith('127.'):
                ips.append(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(None, PORT, socket.AF_INET, socket.SOCK_STREAM):
            ip = info[4][0]
            if ip and not ip.startswith('127.') and ip != '0.0.0.0':
                ips.append(ip)
    except Exception:
        pass
    out, seen = [], set()
    for ip in ips:
        if ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out or ['127.0.0.1']


def ensure_room(room):
    if room not in ROOMS:
        now = time.time()
        ROOMS[room] = {
            'seq': 0,
            'messages': [],
            'poses': {},
            'meta': {
                'name': room,
                'host': '',
                'host_id': '',
                'players': 0,
                'created': now,
                'updated': now,
                'host_beat': now,
                'playing': False,
                'visible': True,
            }
        }
    return ROOMS[room]


def is_host_alive(meta, now=None):
    now = now if now is not None else time.time()
    beat = meta.get('host_beat', 0) or 0
    created = meta.get('created', 0) or 0
    if (now - created) < ROOM_GRACE:
        return True
    return (now - beat) <= HOST_TIMEOUT


def cleanup_rooms():
    now = time.time()
    dead = []
    for k, r in list(ROOMS.items()):
        m = r['meta']
        if not is_host_alive(m, now):
            dead.append(k)
            continue
        if now - m.get('updated', 0) > ROOM_TTL:
            dead.append(k)
    for k in dead:
        ROOMS.pop(k, None)
        # close WS clients in dead room
        clients = WS_ROOMS.pop(k, [])
        for c in clients:
            try:
                c.close()
            except Exception:
                pass


def safe_join(root, rel):
    rel = unquote(rel).lstrip('/').replace('\\', '/')
    if '..' in rel.split('/'):
        return None
    full = os.path.normpath(os.path.join(root, rel))
    if not full.startswith(os.path.normpath(root)):
        return None
    return full


def apply_message(room, data):
    """Update room state from a message. Returns (seq, closed, entry_or_None)."""
    r = ensure_room(room)
    r['meta']['updated'] = time.time()
    closed = False
    entry = None
    seq = r['seq']

    if not isinstance(data, dict):
        r['seq'] += 1
        seq = r['seq']
        entry = {'id': seq, 't': time.time(), 'data': data}
        r['messages'].append(entry)
        if len(r['messages']) > MAX_MSG:
            r['messages'] = r['messages'][-MAX_MSG:]
        return seq, False, entry

    is_pose = data.get('type') == 'pose' and data.get('id')
    is_host_msg = (
        data.get('isHost') or
        (isinstance(data.get('id'), str) and str(data.get('id')).startswith('host_'))
    )

    if is_host_msg or (is_pose and isinstance(data.get('id'), str) and str(data.get('id')).startswith('host_')):
        r['meta']['host_beat'] = time.time()
        if data.get('name') and not r['meta'].get('host'):
            r['meta']['host'] = str(data.get('name'))[:32]
        if data.get('id'):
            r['meta']['host_id'] = str(data.get('id'))

    if is_pose:
        pid = str(data.get('id'))
        r['seq'] += 1
        seq = r['seq']
        entry = {'id': seq, 't': time.time(), 'data': data}
        r['poses'][pid] = entry
        if len(r['poses']) > MAX_POSE_PLAYERS:
            items = sorted(r['poses'].items(), key=lambda kv: kv[1].get('t', 0))
            r['poses'] = dict(items[-MAX_POSE_PLAYERS:])
        r['meta']['players'] = max(1, len(r['poses']))
        return seq, False, entry

    t = data.get('type')
    if t == 'join':
        if data.get('isHost') or data.get('host'):
            r['meta']['host'] = str(data.get('name') or r['meta'].get('host') or '')[:32]
            r['meta']['host_id'] = str(data.get('clientId') or data.get('id') or r['meta'].get('host_id') or '')
            r['meta']['host_beat'] = time.time()
            r['meta']['visible'] = True
        elif data.get('name') and not r['meta'].get('host'):
            r['meta']['host'] = str(data.get('name'))[:32]
    elif t == 'heartbeat' or t == 'hostbeat':
        r['meta']['host_beat'] = time.time()
        if data.get('name'):
            r['meta']['host'] = str(data.get('name'))[:32]
        r['meta']['visible'] = True
        r['meta']['players'] = int(data.get('players') or r['meta'].get('players') or 1)
    elif t == 'start':
        r['meta']['playing'] = True
        r['meta']['host_beat'] = time.time()
    elif t == 'leave' or t == 'exit':
        pid = str(data.get('id') or '')
        if pid:
            r['poses'].pop(pid, None)
        host_id = str(r['meta'].get('host_id') or '')
        is_host_leave = bool(data.get('isHost'))
        if not is_host_leave and pid and host_id and pid == host_id:
            is_host_leave = True
        if not is_host_leave and pid.startswith('host_') and (not host_id or pid == host_id):
            is_host_leave = True
        if is_host_leave:
            ROOMS.pop(room, None)
            return 0, True, None
        r['meta']['players'] = max(0, len(r['poses']))

    if t == 'chat':
        chats = [m for m in r['messages'] if isinstance(m.get('data'), dict) and m['data'].get('type') == 'chat']
        if len(chats) > 30:
            drop_ids = set(m['id'] for m in chats[:-20])
            r['messages'] = [m for m in r['messages'] if m['id'] not in drop_ids]

    r['seq'] += 1
    seq = r['seq']
    entry = {'id': seq, 't': time.time(), 'data': data}
    r['messages'].append(entry)
    if len(r['messages']) > MAX_MSG:
        r['messages'] = r['messages'][-MAX_MSG:]
    return seq, False, entry


def ws_broadcast(room, payload, exclude=None):
    """Send JSON to all WS clients in room except exclude."""
    body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    clients = list(WS_ROOMS.get(room) or [])
    dead = []
    for c in clients:
        if c is exclude:
            continue
        try:
            c.send_text(body)
        except Exception:
            dead.append(c)
    if dead:
        with LOCK:
            lst = WS_ROOMS.get(room) or []
            for d in dead:
                try:
                    lst.remove(d)
                except ValueError:
                    pass
                try:
                    d.close()
                except Exception:
                    pass


class WsClient(object):
    def __init__(self, sock, handler):
        self.sock = sock
        self.handler = handler
        self.room = None
        self.client_id = None
        self.alive = True
        self._wlock = threading.Lock()
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass

    def send_text(self, data):
        if isinstance(data, str):
            data = data.encode('utf-8')
        with self._wlock:
            if not self.alive:
                return
            # single frame text, unmasked (server→client)
            ln = len(data)
            if ln < 126:
                hdr = struct.pack('!BB', 0x81, ln)
            elif ln < 65536:
                hdr = struct.pack('!BBH', 0x81, 126, ln)
            else:
                hdr = struct.pack('!BBQ', 0x81, 127, ln)
            self.sock.sendall(hdr + data)

    def send_json(self, obj):
        self.send_text(json.dumps(obj, separators=(',', ':'), ensure_ascii=False))

    def close(self):
        self.alive = False
        try:
            # close frame
            self.sock.sendall(b'\x88\x00')
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass

    def _recv_exact(self, n):
        buf = b''
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError('closed')
            buf += chunk
        return buf

    def recv_frame(self):
        hdr = self._recv_exact(2)
        b0, b1 = hdr[0], hdr[1]
        opcode = b0 & 0x0F
        masked = (b1 & 0x80) != 0
        ln = b1 & 0x7F
        if ln == 126:
            ln = struct.unpack('!H', self._recv_exact(2))[0]
        elif ln == 127:
            ln = struct.unpack('!Q', self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else None
        payload = self._recv_exact(ln) if ln else b''
        if masked and mask:
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
        return opcode, payload

    def loop(self):
        try:
            while self.alive:
                # short select — respond fast, keep connection warm without long stalls
                r, _, _ = select.select([self.sock], [], [], 8.0)
                if not r:
                    # idle websocket ping (opcode 0x9)
                    try:
                        with self._wlock:
                            self.sock.sendall(b'\x89\x00')
                    except Exception:
                        break
                    continue
                opcode, payload = self.recv_frame()
                if opcode == 0x8:  # close
                    break
                if opcode == 0x9:  # ping → pong
                    with self._wlock:
                        self.sock.sendall(b'\x8A' + bytes([len(payload)]) + payload if len(payload) < 126 else b'\x8A\x00')
                    continue
                if opcode == 0xA:  # pong
                    continue
                if opcode != 0x1:  # text only
                    continue
                try:
                    msg = json.loads(payload.decode('utf-8'))
                except Exception:
                    continue
                self._handle(msg)
        except Exception:
            pass
        finally:
            self._cleanup()

    def _cleanup(self):
        self.alive = False
        room = self.room
        if room:
            with LOCK:
                lst = WS_ROOMS.get(room) or []
                try:
                    lst.remove(self)
                except ValueError:
                    pass
                if self.client_id and room in ROOMS:
                    ROOMS[room]['poses'].pop(str(self.client_id), None)
                    ROOMS[room]['meta']['players'] = max(0, len(ROOMS[room]['poses']))
            if room and self.client_id:
                ws_broadcast(room, {
                    'ok': True,
                    'kind': 'event',
                    'data': {'type': 'leave', 'id': self.client_id}
                }, exclude=self)
        try:
            self.sock.close()
        except Exception:
            pass

    def _handle(self, msg):
        mtype = msg.get('type') or (msg.get('data') or {}).get('type')

        # join / hello
        if mtype == 'hello' or mtype == 'join_ws':
            room = str(msg.get('room') or 'default').strip().lower()
            cid = str(msg.get('id') or msg.get('clientId') or '')
            self.room = room
            self.client_id = cid or self.client_id
            with LOCK:
                ensure_room(room)
                lst = WS_ROOMS.setdefault(room, [])
                if self not in lst:
                    lst.append(self)
                r = ROOMS[room]
                poses = list(r['poses'].values())
                snap_msgs = list(r['messages'][-40:])
            self.send_json({
                'ok': True,
                'kind': 'hello',
                'room': room,
                'poses': poses,
                'messages': snap_msgs,
                't': time.time()
            })
            return

        if mtype == 'ping':
            self.send_json({'ok': True, 'kind': 'pong', 't': time.time(), 'c': msg.get('t')})
            return

        room = self.room or str(msg.get('room') or 'default').strip().lower()
        data = msg.get('data') if 'data' in msg else msg

        if isinstance(data, dict) and data.get('id'):
            self.client_id = str(data.get('id'))

        with LOCK:
            if room not in ROOMS and not (isinstance(data, dict) and data.get('type') in ('join', 'hostbeat', 'pose') and data.get('isHost')):
                # allow host to create
                pass
            seq, closed, entry = apply_message(room, data)
            self.room = room

        if closed:
            ws_broadcast(room, {'ok': True, 'kind': 'dead', 't': time.time()})
            clients = list(WS_ROOMS.pop(room, []))
            for c in clients:
                try:
                    c.send_json({'ok': True, 'kind': 'dead', 't': time.time()})
                    c.close()
                except Exception:
                    pass
            return

        # Broadcast to peers in room
        if isinstance(data, dict) and data.get('type') == 'pose':
            ws_broadcast(room, {
                'ok': True,
                'kind': 'pose',
                'id': seq,
                'data': data,
                't': time.time()
            }, exclude=self)
        else:
            ws_broadcast(room, {
                'ok': True,
                'kind': 'msg',
                'id': seq,
                'data': data,
                't': time.time()
            }, exclude=self)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Keep-Alive', 'timeout=30, max=1000')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()')
        self.send_header('Feature-Policy', "microphone 'self'")

    def _json(self, code, obj):
        body = json.dumps(obj, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path):
        try:
            ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
            if path.endswith('.js'):
                ctype = 'application/javascript; charset=utf-8'
            elif path.endswith('.css'):
                ctype = 'text/css; charset=utf-8'
            elif path.endswith('.html'):
                ctype = 'text/html; charset=utf-8'
            elif path.endswith('.json'):
                ctype = 'application/json; charset=utf-8'
            with open(path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()')
            base = os.path.basename(path)
            if base in ('three.min.js', 'peerjs.min.js', 'jszip.min.js'):
                self.send_header('Cache-Control', 'public, max-age=86400')
            else:
                self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self.send_response(404)
            self._cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        path = u.path or '/'

        # --- WebSocket upgrade ---
        if path == '/ws':
            self._websocket_upgrade()
            return

        if path == '/status':
            with LOCK:
                cleanup_rooms()
                rooms = list(ROOMS.keys())
                ws_count = sum(len(v) for v in WS_ROOMS.values())
            self._json(200, {
                'ok': True,
                'service': 'story-mode-lan',
                'port': PORT,
                'ips': local_ips(),
                'rooms': rooms,
                'fast': True,
                'turbo': True,
                'ws': True,
                'ws_clients': ws_count,
                't': time.time()
            })
            return

        if path == '/rooms':
            with LOCK:
                cleanup_rooms()
                now = time.time()
                out = []
                for code, r in ROOMS.items():
                    m = r['meta']
                    if not is_host_alive(m, now):
                        continue
                    if not m.get('visible', True):
                        continue
                    out.append({
                        'code': code,
                        'host': m.get('host') or '',
                        'players': m.get('players') or max(1, len(r.get('poses') or {})),
                        'playing': bool(m.get('playing')),
                        'updated': m.get('updated', 0),
                    })
                out.sort(key=lambda x: -x['updated'])
            self._json(200, {'ok': True, 'rooms': out, 't': time.time()})
            return

        if path == '/ping':
            self._json(200, {'ok': True, 't': time.time()})
            return

        # HTTP poll kept as fallback
        if path == '/poll':
            qs = parse_qs(u.query)
            room = (qs.get('room') or ['default'])[0].strip().lower()
            try:
                since = int((qs.get('since') or ['0'])[0] or 0)
            except Exception:
                since = 0
            with LOCK:
                if room not in ROOMS:
                    self._json(200, {
                        'ok': True, 'messages': [], 'poses': [],
                        'missing': True, 'dead': False, 't': time.time()
                    })
                    return
                r = ROOMS[room]
                now = time.time()
                if not is_host_alive(r['meta'], now):
                    del ROOMS[room]
                    self._json(200, {'ok': True, 'messages': [], 'poses': [], 'dead': True, 't': time.time()})
                    return
                r['meta']['updated'] = now
                msgs = [m for m in r['messages'] if m['id'] > since] if since else list(r['messages'])
                poses = list(r['poses'].values())
            self._json(200, {'ok': True, 'messages': msgs, 'poses': poses, 't': time.time()})
            return

        if path == '/' or path == '':
            index = os.path.join(ROOT, 'index.html')
            if os.path.isfile(index):
                self._file(index)
                return
            body = (
                '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8">'
                '<title>Story Mode Host</title><body style="font-family:Tahoma;background:#0b1220;color:#e2e8f0;padding:24px">'
                '<h1>Story Mode — السيرفر شغال ✓ (WebSocket)</h1>'
                '<p>ضع index.html بجانب lan_host.py ثم أعد التشغيل.</p>'
                '<p>API: <a href="/status" style="color:#67e8f9">/status</a></p>'
                '</body></html>'
            ).encode('utf-8')
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        rel = path.lstrip('/')
        full = safe_join(ROOT, rel)
        if full and os.path.isfile(full):
            self._file(full)
            return

        self.send_response(404)
        self._cors()
        body = b'{"ok":false,"error":"not found"}'
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _websocket_upgrade(self):
        key = self.headers.get('Sec-WebSocket-Key')
        if not key:
            self.send_response(400)
            self.end_headers()
            return
        accept = base64.b64encode(hashlib.sha1(key.encode('utf-8') + WS_GUID).digest()).decode('ascii')
        self.send_response(101, 'Switching Protocols')
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept)
        self.end_headers()
        # Take ownership of the socket — handler must not close it after return
        sock = self.connection
        try:
            self.close_connection = True
        except Exception:
            pass
        client = WsClient(sock, self)
        client.loop()

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        if length > 65536:
            length = 65536
        raw = self.rfile.read(length) if length else b'{}'
        try:
            payload = json.loads(raw.decode('utf-8'))
        except Exception:
            payload = {}

        if u.path == '/send':
            room = str(payload.get('room') or 'default').strip().lower()
            data = payload.get('data')
            with LOCK:
                seq, closed, entry = apply_message(room, data)
            if closed:
                ws_broadcast(room, {'ok': True, 'kind': 'dead', 't': time.time()})
                self._json(200, {'ok': True, 'id': 0, 'closed': True, 't': time.time()})
                return
            # also push via WS for hybrid clients
            if isinstance(data, dict) and data.get('type') == 'pose':
                ws_broadcast(room, {'ok': True, 'kind': 'pose', 'id': seq, 'data': data, 't': time.time()})
            else:
                ws_broadcast(room, {'ok': True, 'kind': 'msg', 'id': seq, 'data': data, 't': time.time()})
            self._json(200, {'ok': True, 'id': seq, 't': time.time()})
            return

        if u.path == '/roommeta':
            room = str(payload.get('room') or 'default').strip().lower()
            with LOCK:
                if payload.get('close') or payload.get('delete'):
                    ROOMS.pop(room, None)
                    clients = list(WS_ROOMS.pop(room, []))
                    self._json(200, {'ok': True, 'closed': True})
                    for c in clients:
                        try:
                            c.send_json({'ok': True, 'kind': 'dead', 't': time.time()})
                            c.close()
                        except Exception:
                            pass
                    return
                r = ensure_room(room)
                m = r['meta']
                if payload.get('host'):
                    m['host'] = str(payload.get('host'))[:32]
                if payload.get('host_id'):
                    m['host_id'] = str(payload.get('host_id'))
                if 'players' in payload:
                    try:
                        m['players'] = int(payload.get('players') or 0)
                    except Exception:
                        pass
                if 'playing' in payload:
                    m['playing'] = bool(payload.get('playing'))
                if 'visible' in payload:
                    m['visible'] = bool(payload.get('visible'))
                m['host_beat'] = time.time()
                m['updated'] = time.time()
            self._json(200, {'ok': True})
            return

        self.send_response(404)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()


def main():
    ips = local_ips()
    print('========================================')
    print('  Story Mode — مضيف (HTTP + WebSocket)')
    print('  LAN Turbo / تزامن فوري')
    print('========================================')
    print('المنفذ:', PORT)
    print('الفولدر:', ROOT)
    print('')
    print('افتح من أي جهاز على الشبكة:')
    for ip in ips:
        print('  →  http://%s:%d/' % (ip, PORT))
    print('  >>>  http://127.0.0.1:%d/   ← المايك يشتغل هنا' % PORT)
    print('')
    print('WebSocket: ws://IP:%d/ws' % PORT)
    print('الموبايل: نفس الواي فاي → الصق الرابط فوق في المتصفح')
    print('فحص API: http://IP:%d/status' % PORT)
    print('========================================')
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    server.daemon_threads = True
    try:
        server.request_queue_size = 256
    except Exception:
        pass
    try:
        server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 512 * 1024)
        server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 512 * 1024)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nتم الإيقاف.')


if __name__ == '__main__':
    try:
        main()
    except OSError as e:
        # المنفذ مستخدم أو صلاحيات
        print('')
        print('========================================')
        print('  خطأ في تشغيل السيرفر')
        print('========================================')
        print(e)
        if getattr(e, 'errno', None) in (98, 10048, 48):  # address in use
            print('')
            print('المنفذ %s مستخدم بالفعل.' % PORT)
            print('اقفل أي نافذة سيرفر قديمة أو غيّر المنفذ:')
            print('  set STORY_PORT=27101')
            print('  python lan_host.py')
        print('')
        try:
            input('اضغط Enter للإغلاق...')
        except Exception:
            import time
            time.sleep(12)
    except Exception as e:
        print('')
        print('========================================')
        print('  حصل خطأ:')
        print('========================================')
        print(type(e).__name__ + ':', e)
        print('')
        try:
            input('اضغط Enter للإغلاق...')
        except Exception:
            import time
            time.sleep(12)
