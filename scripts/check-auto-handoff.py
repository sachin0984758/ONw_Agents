"""Exercise the real native handoff with fake UIA observations; sends no input."""
import ast
import hashlib
import re
from pathlib import Path
from types import SimpleNamespace

source = Path(__file__).resolve().parents[1] / 'agenthub-computer/controller.py'
module = ast.parse(source.read_text())
controller = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == 'Controller')
controller.body = [node for node in controller.body if isinstance(node, ast.FunctionDef) and node.name in ['execute', 'target', 'unchanged_observation', 'content_fingerprint', 'text']]
now = 1000
namespace = {'time': SimpleNamespace(monotonic=lambda: now), 'hashlib': hashlib, 'PROTECTED_CONTROL': re.compile(r'terminal|powershell|command prompt|debug console', re.I)}
exec(compile(ast.fix_missing_locations(ast.Module(body=[controller], type_ignores=[])), str(source), 'exec'), namespace)
Controller = namespace['Controller']
passed = 0

def snapshot(created=880):
    window = dict(handle=1, pid=2, host_pid=2, process='notepad.exe', process_started=10, bounds=[0, 0, 800, 600], title='Untitled - Notepad')
    item = dict(id='e0', name='Text editor', control_type='Document', automation_id='editor', bounds=[1, 1, 799, 599], enabled=True, focused=False, text='unchanged')
    control = SimpleNamespace(is_visible=lambda: True, is_enabled=lambda: True,
        element_info=SimpleNamespace(element=SimpleNamespace(CurrentIsPassword=False), name='Text editor'),
        rectangle=lambda: SimpleNamespace(left=1, top=1, right=799, bottom=599), parent=lambda: None)
    return dict(created=created, window=window, controls={'e0': (control, item)}, control_ids={'e0': (42,)}, content_fingerprints={'e0': 'full-text-hash'})

def instance(original, fresh):
    value = Controller.__new__(Controller)
    value.snapshots = {'old': original}
    value.gate = lambda *_: None
    value.window = lambda *_: fresh['window']
    def focus(handle, expected):
        for key in ['handle', 'pid', 'host_pid', 'process', 'process_started']:
            if expected[key] != fresh['window'][key]:
                raise ValueError('Window identity changed')
        value.snapshots = {'fresh': fresh}
        return {'observation': {'snapshot_id': 'fresh', 'window': fresh['window']}}
    value.focus = focus
    return value

def check(label, action):
    global passed
    action()
    passed += 1
    print('PASS ' + label)

def denied(action):
    try:
        action()
    except ValueError:
        return
    raise AssertionError('Unsafe handoff was accepted')

args = {'snapshot_id': 'old', 'element_id': 'e0', 'text': 'test'}
def handoff(original, fresh, target=args):
    return instance(original, fresh).execute('desktop.approval_handoff', target)

def renewal():
    result = handoff(snapshot(), snapshot(now))
    assert result['args']['snapshot_id'] == 'fresh'
    assert result['args']['element_id'] == 'e0'
check('120-second model latency refreshes unchanged semantic target', renewal)
check('unknown snapshot is rejected', lambda: denied(lambda: instance(snapshot(), snapshot(now)).execute('desktop.approval_handoff', {'snapshot_id': 'missing'})))
check('evidence older than 15 minutes is rejected', lambda: denied(lambda: handoff(snapshot(0), snapshot(now))))
check('aged raw coordinates cannot be renewed', lambda: denied(lambda: handoff(snapshot(), snapshot(now), {'snapshot_id': 'old', 'x': 10, 'y': 10})))
for label, mutate in [
    ('changed document', lambda fresh: fresh['controls']['e0'][1].update(text='changed')),
    ('changed full text beyond the excerpt', lambda fresh: fresh['content_fingerprints'].update(e0='different-hash')),
    ('unverifiable full text', lambda fresh: fresh['content_fingerprints'].update(e0=None)),
    ('changed tab title', lambda fresh: fresh['window'].update(title='Other document')),
    ('reused process handle', lambda fresh: fresh['window'].update(pid=99)),
    ('changed UIA control identity', lambda fresh: fresh['control_ids'].update(e0=(99,))),
    ('changed layout', lambda fresh: fresh['controls']['e0'][1].update(bounds=[2, 2, 799, 599])),
]:
    fresh = snapshot(now)
    mutate(fresh)
    check(label + ' is rejected', lambda fresh=fresh: denied(lambda: handoff(snapshot(), fresh)))
fresh = snapshot(now)
fresh['controls']['e0'][1]['focused'] = True
check('dashboard focus changes alone do not invalidate an unchanged target', lambda: handoff(snapshot(), fresh))
value = instance(snapshot(), snapshot(now))
value.gate = lambda *_: (_ for _ in ()).throw(ValueError('Session revoked'))
check('revocation still blocks renewal', lambda: denied(lambda: value.execute('desktop.approval_handoff', args)))
check('ordinary input cannot consume an expired snapshot', lambda: denied(lambda: instance(snapshot(), snapshot(now)).target(args)))
def long_readback():
    text = '\n'.join(f'{i + 1}. ' + 'A line from the safe fixture story.' * 2 for i in range(100))
    assert 5000 < len(text) <= 8000
    control = SimpleNamespace(iface_text=SimpleNamespace(DocumentRange=SimpleNamespace(GetText=lambda limit: text[:limit])))
    assert Controller.text(control) == text
    assert Controller.content_fingerprint(control) == hashlib.sha256(text.encode()).hexdigest()
check('100-line editor readback is not cut off at 5000 characters', long_readback)
print(f'\n{passed} native handoff fixture checks passed; no live desktop input was sent.')
