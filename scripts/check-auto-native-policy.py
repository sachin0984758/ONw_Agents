"""Exercise actual native permission methods without launching or controlling apps."""
import ast
import os
import re
import threading
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import urlparse
from tempfile import TemporaryDirectory

source = Path(__file__).resolve().parents[1] / 'agenthub-computer' / 'controller.py'
module = ast.parse(source.read_text())
controller = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == 'Controller')
controller.body = [node for node in controller.body if isinstance(node, ast.FunctionDef) and node.name in ['__init__', 'stop', 'allowed_url', 'execute']]
class PolicyInput:
    """No native input in these permission-only tests."""
    def __init__(self, lock):
        self.pointer_profile = 'normal'

    def release_all(self):
        return []


namespace = dict(os=os, re=re, threading=threading, urlparse=urlparse, APPS={'notepad': []},
                 win32gui=SimpleNamespace(GetForegroundWindow=lambda: 1),
                 win32api=SimpleNamespace(MonitorFromWindow=lambda *_: 1, GetMonitorInfo=lambda *_: {'Work': (0, 0, 1920, 1080)}),
                 NativeInput=PolicyInput, POINTER_DURATIONS={'fast': .08, 'normal': .35, 'demonstration': 1.0})
exec(compile(ast.fix_missing_locations(ast.Module(body=[controller], type_ignores=[])), str(source), 'exec'), namespace)
instance = namespace['Controller']()
passed = 0

def check(label, value):
    global passed
    assert value, label
    passed += 1
    print('PASS ' + label)

def denied(label, action):
    try:
        action()
    except ValueError:
        check(label, True)
        return
    raise AssertionError(label)

check('native defaults have no file/app/domain/internet grants', instance.workspace_root == '' and not instance.allowed and not instance.domains and not instance.internet)
denied('native rejects an empty grant', lambda: instance.execute('control.start', {'applications': [], 'domains': []}))
denied('native rejects implicit current-directory access', lambda: instance.execute('control.start', {'applications': ['notepad'], 'workspaceAccess': 'read', 'workspace_root': ''}))
denied('native rejects external domains without internet', lambda: instance.execute('control.start', {'applications': ['browser'], 'domains': ['example.org']}))
instance.execute('control.start', {'applications': ['browser'], 'domains': ['localhost']})
instance.allowed_url('http://localhost/test')
check('native permits an explicitly listed local host', True)
denied('native refuses non-listed loopback host', lambda: instance.allowed_url('http://127.0.0.1/test'))
denied('native refuses internet without permission', lambda: instance.allowed_url('https://example.org/test'))
instance.execute('control.start', {'applications': ['browser'], 'domains': ['example.org'], 'internet': True})
instance.allowed_url('https://example.org/test')
check('native permits only explicitly granted remote hostname', True)
for url in ['https://sub.example.org', 'file:///C:/Windows/win.ini', 'https://name:secret@example.org', 'https://unlisted.org']:
    denied('native refuses unsafe or outside URL: ' + url, lambda url=url: instance.allowed_url(url))
with TemporaryDirectory(prefix='auto-native-policy-') as folder:
    denied('observe only cannot grant writes', lambda: instance.execute('control.start', {'applications': ['notepad'], 'workspace_root': folder, 'workspaceAccess': 'write', 'readonly': True}))
    instance.execute('control.start', {'applications': [], 'workspace_root': folder, 'workspaceAccess': 'read'})
    check('explicit file-only grant uses the exact real folder', instance.workspace_root == os.path.realpath(folder))
    instance.stop()
    check('native stop revokes all grants', not instance.enabled and not instance.allowed and not instance.domains and instance.workspace_root == '' and not instance.internet and instance.workspace_access == 'none')
    denied('background requests fail after revoke', lambda: instance.allowed_url('https://example.org'))
print(f'\n{passed} native permission checks passed.')
