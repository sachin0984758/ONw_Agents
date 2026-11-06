"""AgentHub's loopback-only Windows UIA/DOM companion. No shell execution API."""
import base64
import ctypes
import hmac
import hashlib
import io
import json
import os
import queue
import re
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

if os.name != 'nt':
    raise SystemExit('Computer Use currently requires Windows.')
try:
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    pass

import psutil
import pyautogui
import win32gui
import win32api
import win32ui
import win32process
from pywinauto import Desktop
from PIL import Image, ImageDraw
import mss
from native_input import NativeInput, POINTER_DURATIONS, KEYS, USER32, normalize_key

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.03
from ctypes import wintypes
ctypes.windll.user32.OpenInputDesktop.restype = wintypes.HANDLE
ctypes.windll.user32.GetUserObjectInformationW.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
ctypes.windll.user32.CloseDesktop.argtypes = [wintypes.HANDLE]
TOKEN = os.environ.get('AGENTHUB_COMPUTER_TOKEN', '')
if len(TOKEN) < 40:
    raise SystemExit('Launch this companion from AgentHub; an IPC credential is required.')
PARENT = int(os.environ.get('AGENTHUB_COMPUTER_PARENT', '0'))
DENIED = re.compile(r'password|credential|keepass|1password|bitwarden|lastpass|logonui|consent|securityhealth|cmd\.exe|powershell|pwsh|windowsterminal', re.I)
SENSITIVE = re.compile(r'password|passcode|secret|api.?key|credit.?card|cvv|one.?time.?code|\bpin\b|security code|verification code', re.I)
PROTECTED_CONTROL = re.compile(r'terminal|powershell|command prompt|debug console', re.I)
APPS = {
    'notepad': [Path(os.environ['WINDIR']) / 'System32/notepad.exe'],
    'explorer': [Path(os.environ['WINDIR']) / 'explorer.exe'],
    'vscode': [Path(os.environ['LOCALAPPDATA']) / 'Programs/Microsoft VS Code/Code.exe', Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Microsoft VS Code/Code.exe'],
    'calculator': [Path(os.environ['WINDIR']) / 'System32/calc.exe'],
}
PROCESSES = {'notepad': ['notepad.exe'], 'explorer': ['explorer.exe'], 'vscode': ['code.exe'], 'calculator': ['calculatorapp.exe', 'calculator.exe']}


class Controller:
    def __init__(self):
        self.input_lock = threading.RLock()
        self.input = NativeInput(self.input_lock)
        self.generation = 0
        self.operation = threading.local()
        self.release_errors = []
        self.screenshots = True
        self.enabled = False
        self.readonly = True
        self.allowed = set()
        self.domains = set()
        self.stopped = threading.Event()
        self.paused = threading.Event()
        self.snapshots = {}
        self.browser = None
        self.browser_context = None
        self.playwright = None
        self.pages = {}
        self.workspace_root = ''
        self.workspace_access = 'none'
        self.internet = False

    def stop(self):
        with self.input_lock:
            self.enabled = False
            self.generation += 1
            self.stopped.set()
            self.paused.clear()
            self.release_errors = self.input.release_all()
            self.snapshots.clear()
            self.allowed.clear()
            self.domains.clear()
            self.workspace_root = ''
            self.workspace_access = 'none'
            self.internet = False

    def pause(self):
        with self.input_lock:
            self.generation += 1
            self.paused.set()
            self.release_errors = self.input.release_all()
            self.snapshots.clear()

    def gate(self, mutation=False):
        if not self.enabled or self.stopped.is_set():
            raise ValueError('Computer control is stopped. Enable it explicitly in Auto.')
        if getattr(self.operation, 'generation', self.generation) != self.generation:
            raise ValueError('This action was cancelled. Inspect again after resuming.')
        if self.paused.is_set():
            raise ValueError('Computer control is paused. Resume explicitly and inspect again.')
        if mutation and self.readonly:
            raise ValueError('Read-only mode does not permit input or navigation.')
        # A locked or UAC secure desktop must never be bypassed.
        desktop = ctypes.windll.user32.OpenInputDesktop(0, False, 0x0001)
        if not desktop:
            self.stop()
            raise ValueError('The input desktop is locked or unavailable.')
        try:
            name = ctypes.create_unicode_buffer(256)
            needed = ctypes.c_ulong()
            ctypes.windll.user32.GetUserObjectInformationW(desktop, 2, name, ctypes.sizeof(name), ctypes.byref(needed))
            if name.value.lower() != 'default':
                self.stop()
                raise ValueError('A protected desktop is active. Control stopped.')
        finally:
            ctypes.windll.user32.CloseDesktop(desktop)

    def window(self, handle, require_allowed=True):
        handle = int(handle)
        if not win32gui.IsWindow(handle) or not win32gui.IsWindowVisible(handle):
            raise ValueError('The target window no longer exists or is hidden. Observe again.')
        handle = win32gui.GetAncestor(handle, 2)
        _, pid = win32process.GetWindowThreadProcessId(handle)
        host_pid = pid
        process = psutil.Process(pid)
        name = process.name().lower()
        # UWP Calculator's content process is hosted by a separate top-level
        # ApplicationFrameHost window. Authorize the actual content process,
        # while focus, bounds and hit-testing use its observed root frame.
        if name == 'applicationframehost.exe':
            contents = {}
            def child_identity(child, _):
                if win32gui.GetClassName(child) == 'Windows.UI.Core.CoreWindow':
                    _, child_pid = win32process.GetWindowThreadProcessId(child)
                    child_process = psutil.Process(child_pid)
                    if child_process.name().lower() in PROCESSES['calculator']:
                        contents[child_pid] = child_process
            win32gui.EnumChildWindows(handle, child_identity, None)
            if len(contents) == 1:
                pid, process = next(iter(contents.items()))
                name = process.name().lower()
        if DENIED.search(name):
            raise ValueError('This application is protected from computer control.')
        allowed = any(name in PROCESSES.get(app, []) for app in self.allowed)
        if require_allowed and not allowed:
            raise ValueError(f'The target application ({name}) is outside the session allowlist. Review Session permissions and select the intended app, then grant access again. A dashboard/browser window is not the same target as Notepad.')
        return {'handle': handle, 'pid': pid, 'host_pid': host_pid, 'process_started': process.create_time(), 'process': name, 'title': win32gui.GetWindowText(handle)[:200], 'allowed': allowed, 'bounds': list(win32gui.GetWindowRect(handle)), 'minimized': bool(win32gui.IsIconic(handle))}

    def windows(self):
        result = []
        def visit(hwnd, _):
            if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
                try:
                    window = self.window(hwnd, False)
                    if not window['allowed']:
                        window['title'] = '(not permitted)'
                    if not any(existing['handle'] == window['handle'] for existing in result):
                        result.append(window)
                except Exception:
                    pass
        win32gui.EnumWindows(visit, None)
        return result[:100]

    def inspect(self, handle):
        self.gate()
        window = self.window(handle)
        if window['minimized']:
            raise ValueError('The window is minimized. Focus it before inspecting.')
        wrapper = Desktop(backend='uia').window(handle=int(handle)).wrapper_object()
        snapshot = uuid.uuid4().hex
        controls = {}
        control_ids = {}
        content_fingerprints = {}
        items = []
        for control in [wrapper] + wrapper.descendants(depth=6)[:500]:
            try:
                info = control.element_info
                if info.element.CurrentIsPassword or not control.is_visible():
                    continue
                name = info.name[:300]
                if SENSITIVE.search(name) or PROTECTED_CONTROL.search(name):
                    continue
                rect = control.rectangle()
                if rect.width() <= 0 or rect.height() <= 0:
                    continue
                # IDs are scoped by the required, unguessable snapshot_id. Avoid
                # repeating that 32-character token for every UI control.
                element_id = f'e{len(items)}'
                patterns = [p for p in ['value', 'text', 'invoke', 'selection', 'toggle', 'scroll'] if self.pattern(control, p)]
                item = {'id': element_id, 'name': name, 'control_type': info.control_type, 'automation_id': info.automation_id, 'bounds': [rect.left, rect.top, rect.right, rect.bottom], 'enabled': control.is_enabled(), 'focused': control.has_keyboard_focus(), 'patterns': patterns}
                if info.control_type in ['Edit', 'Document', 'Text']:
                    item['text'] = self.text(control)[:2500]
                    if info.control_type in ['Edit', 'Document']:
                        content_fingerprints[element_id] = self.content_fingerprint(control)
                    try:
                        rectangles = list(control.iface_text.DocumentRange.GetBoundingRectangles())
                        item['text_rects'] = [rectangles[i:i+4] for i in range(0, min(len(rectangles), 96), 4)]
                    except Exception:
                        pass
                controls[element_id] = (control, item)
                try:
                    control_ids[element_id] = tuple(info.runtime_id)
                except Exception:
                    pass
                items.append(item)
            except Exception:
                continue
        self.snapshots = {snapshot: {'window': window, 'controls': controls, 'control_ids': control_ids, 'content_fingerprints': content_fingerprints, 'created': time.monotonic()}}
        return {'snapshot_id': snapshot, 'window': window, 'elements': items, 'truncated': len(items) >= 500}

    @staticmethod
    def pattern(control, name):
        try:
            return getattr(control, 'iface_' + name) is not None
        except Exception:
            return False

    @staticmethod
    def text(control):
        try:
            return str(control.iface_value.CurrentValue)[:100001]
        except Exception:
            try:
                return str(control.iface_text.DocumentRange.GetText(100001))
            except Exception:
                return control.window_text()[:100001]

    @staticmethod
    def content_fingerprint(control):
        # UI excerpts are truncated. Compare the bounded full editor content
        # before renewing old evidence, including changes beyond the excerpt.
        try:
            text = str(control.iface_text.DocumentRange.GetText(100001))
        except Exception:
            try:
                text = str(control.iface_value.CurrentValue)
            except Exception:
                return None
        if len(text) > 100000:
            return None
        return hashlib.sha256(text.encode('utf-8')).hexdigest()

    @staticmethod
    def unchanged_observation(original, current):
        if any(original['window'].get(key) != current['window'].get(key) for key in ['handle', 'pid', 'host_pid', 'process', 'process_started', 'title', 'bounds']):
            return False
        if original['control_ids'] != current['control_ids'] or set(original['controls']) != set(current['controls']):
            return False
        fields = ['name', 'control_type', 'automation_id', 'bounds', 'enabled', 'text']
        for element_id, (_, item) in original['controls'].items():
            if element_id not in original['control_ids']:
                return False
            other = current['controls'][element_id][1]
            if any(item.get(key) != other.get(key) for key in fields):
                return False
            if item['control_type'] in ['Edit', 'Document']:
                fingerprint = original.get('content_fingerprints', {}).get(element_id)
                if fingerprint is None or fingerprint != current.get('content_fingerprints', {}).get(element_id):
                    return False
        return True

    @staticmethod
    def selection_text(control):
        try:
            ranges = control.iface_text.GetSelection()
            return ''.join(ranges.GetElement(i).GetText(5000) for i in range(min(ranges.Length, 20)))
        except Exception:
            return None

    @staticmethod
    def set_text_value(control, text):
        try:
            control.iface_value.SetValue(text)
        except Exception:
            control.set_edit_text(text)

    def target(self, args):
        snapshot = self.snapshots.get(args.get('snapshot_id'))
        if not snapshot or time.monotonic() - snapshot['created'] > 90:
            raise ValueError('Stale observation. Inspect the target window again.')
        window = self.window(snapshot['window']['handle'])
        if any(window[key] != snapshot['window'][key] for key in ['handle', 'pid', 'host_pid', 'process_started', 'bounds']):
            raise ValueError('The window moved or changed identity. Inspect it again.')
        control = None
        if args.get('element_id'):
            control, item = snapshot['controls'].get(args['element_id'], (None, None))
            if control is None or not control.is_visible() or not control.is_enabled() or control.element_info.element.CurrentIsPassword:
                raise ValueError('The element is unavailable. Inspect again.')
            rect = control.rectangle()
            if item['bounds'] != [rect.left, rect.top, rect.right, rect.bottom] or control.element_info.name[:300] != item['name']:
                raise ValueError('The element moved. Inspect again.')
            parent = control
            for _ in range(8):
                if parent is None:
                    break
                if PROTECTED_CONTROL.search(parent.element_info.name):
                    raise ValueError('Terminal panes are protected. Use approved session command tools instead.')
                parent = parent.parent()
        return window, control

    def dock_right(self, handle):
        """Place the real permitted window in the session monitor's right half."""
        with self.input_lock:
            self.gate(True)
            window = self.window(handle)
            work = getattr(self, 'dock_work', None) or win32api.GetMonitorInfo(win32api.MonitorFromWindow(window['handle'], 2))['Work']
            left, top, right, bottom = work
            middle = left + (right - left) // 2
            win32gui.ShowWindow(window['handle'], 9)
            win32gui.SetWindowPos(window['handle'], 0, middle, top, right - middle, bottom - top, 0x0010 | 0x0004)
            self.snapshots.clear()
        self.stopped.wait(0.12)
        self.gate(True)
        actual = self.window(window['handle'])
        # Some windows enforce a minimum width. Refuse rather than cover chat.
        if actual['bounds'][0] < middle - 8 or actual['bounds'][2] > right + 8:
            raise ValueError('This app could not fit in the right half of the screen. Resize it manually before continuing.')
        return actual

    def restore_right(self, handle, expected=None):
        """Restore a previously observed permitted window, then dock it right.

        Approval UI temporarily takes foreground and Windows may minimize or
        hide the target. Validate the observed HWND's owning process before
        showing it so a recycled handle can never surface an unrelated app.
        """
        self.gate(True)
        handle = int(handle)
        if not win32gui.IsWindow(handle):
            raise ValueError('The approved app window no longer exists. Inspect it again before approving another action.')
        root = win32gui.GetAncestor(handle, 2)
        if not root:
            raise ValueError('The approved app window is no longer available. Inspect it again.')
        _, host_pid = win32process.GetWindowThreadProcessId(root)
        if expected and host_pid != int(expected['host_pid']):
            raise ValueError('The approved window handle now belongs to another process. Inspect it again.')
        host = psutil.Process(host_pid)
        if DENIED.search(host.name().lower()):
            raise ValueError('The approved app window is protected from computer control.')
        if expected and expected['host_pid'] == expected['pid'] and abs(host.create_time() - float(expected['process_started'])) > 0.01:
            raise ValueError('The approved app process restarted. Inspect the new window before continuing.')
        with self.input_lock:
            self.gate(True)
            # Restore even a hidden/minimized window before asking UIA for its
            # children; UIA can otherwise report the old editor as unavailable.
            win32gui.ShowWindow(root, 9)  # SW_RESTORE
        self.stopped.wait(0.12)
        self.gate(True)
        window = self.window(root)
        if expected and any(window[key] != expected[key] for key in ['handle', 'pid', 'host_pid', 'process', 'process_started']):
            raise ValueError('The approved application changed while confirmation was open. Inspect it again.')
        return self.dock_right(root)

    def focus(self, handle, expected=None):
        with self.input_lock:
            self.gate(True)
            window = self.restore_right(handle, expected)
            handle = window['handle']
            wrapper = Desktop(backend='uia').window(handle=int(handle)).wrapper_object()
            wrapper.set_focus()
        deadline = time.monotonic() + 3
        while win32gui.GetForegroundWindow() != int(handle):
            self.gate(True)
            if time.monotonic() >= deadline:
                raise ValueError('Windows refused focus. Activate the window manually and retry.')
            self.stopped.wait(0.03)
        return {'verified': True, 'observation': self.inspect(handle)}

    def point(self, window, x, y, semantic=False):
        if window['process'] == 'code.exe' and not semantic:
            raise ValueError('VS Code requires semantic elements; coordinate input could target an embedded terminal.')
        x, y = int(x), int(y)
        left, top, right, bottom = window['bounds']
        if not (left <= x < right and top <= y < bottom):
            raise ValueError('Coordinates are outside the observed window.')
        monitors = [dict(m) for m in mss.mss().monitors[1:]]
        if not any(m['left'] <= x < m['left'] + m['width'] and m['top'] <= y < m['top'] + m['height'] for m in monitors):
            raise ValueError('Coordinates are outside connected displays.')
        hit = win32gui.WindowFromPoint((x, y))
        hit_root = win32gui.GetAncestor(hit, 2)
        if hit_root != window['handle']:
            raise ValueError(f'Another window covers target ({x}, {y}); expected window {window["handle"]}, hit window {hit_root}. Reobserve before retrying.')
        return x, y

    def input_guard(self, window, args=None, point=None):
        self.gate(True)
        pyautogui.failSafeCheck()
        current = self.window(window['handle'])
        if any(current[key] != window[key] for key in ['handle', 'pid', 'host_pid', 'process_started', 'bounds']):
            raise ValueError('The target window moved or changed. Inspect it again.')
        if win32gui.GetForegroundWindow() != window['handle']:
            self.pause()
            raise ValueError('Focus changed. Computer control paused; inspect before resuming.')
        for key in ('ctrl', 'alt', 'shift', 'win'):
            if key not in self.input.keys and USER32.GetAsyncKeyState(KEYS[key]) & 0x8000:
                raise ValueError('A physical modifier key is held. Release it before automation.')
        if args:
            self.target(args)
        if point:
            self.point(window, *point, semantic=bool(args and args.get('element_id')))

    def pointer_action(self, name, args, window, control):
        if control is not None:
            rect = control.rectangle()
            point = ((rect.left + rect.right)//2, (rect.top + rect.bottom)//2)
        else:
            point = (args.get('x'), args.get('y'))
        if name == 'desktop.drag':
            point = (args['from_x'], args['from_y'])
        if None in point:
            raise ValueError('Choose an observed element or both screen coordinates.')
        point = self.point(window, *point, semantic=control is not None)
        guard = lambda: self.input_guard(window, args, point)
        evidence = self.input.move(*point, guard, args.get('duration_ms', None)/1000 if 'duration_ms' in args else None)
        guard()  # Reacquire the observed control after pointer motion, before input.
        if name in ('desktop.click', 'desktop.double_click', 'desktop.right_click'):
            self.input.click('right' if name == 'desktop.right_click' else 'left', 2 if name == 'desktop.double_click' else 1, guard)
        elif name == 'desktop.mouse_down':
            self.input.button_down(args.get('button', 'left'), guard)
        elif name == 'desktop.scroll':
            self.input.scroll(args['clicks'], guard)
        elif name == 'desktop.drag':
            end = self.point(window, args['to_x'], args['to_y'], semantic=control is not None)
            self.input.button_down('left', guard)
            try:
                evidence['drag'] = self.input.move(*end, lambda: self.input_guard(window, args, end), args.get('duration_ms', 350)/1000)
            finally:
                self.input.button_up('left')
        return evidence

    def capture(self, handle):
        self.gate()
        if not self.screenshots:
            raise ValueError('Screenshots are disabled for this task.')
        window = self.window(handle)
        if window['minimized']:
            raise ValueError('Restore the permitted window before capturing it.')
        left, top, right, bottom = window['bounds']
        width, height = right-left, bottom-top
        # PrintWindow renders only this approved HWND into a private bitmap, so
        # the app can be mirrored in AgentHub without forcing it to the front or
        # accidentally capturing an unrelated window that overlaps it.
        source = win32gui.GetWindowDC(window['handle'])
        source_dc = win32ui.CreateDCFromHandle(source)
        memory_dc = source_dc.CreateCompatibleDC()
        bitmap = win32ui.CreateBitmap()
        bitmap.CreateCompatibleBitmap(source_dc, width, height)
        previous_bitmap = memory_dc.SelectObject(bitmap)
        try:
            print_window = ctypes.windll.user32.PrintWindow
            print_window.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
            print_window.restype = wintypes.BOOL
            rendered = print_window(window['handle'], memory_dc.GetSafeHdc(), 2)
            if not rendered:
                if win32gui.GetForegroundWindow() != window['handle']:
                    raise ValueError('Windows could not render this background app. Bring it forward and refresh.')
                with mss.mss() as screen:
                    pixels = screen.grab({'left': left, 'top': top, 'width': width, 'height': height})
                image = Image.frombytes('RGB', pixels.size, pixels.rgb)
            else:
                image = Image.frombuffer('RGB', (width, height), bitmap.GetBitmapBits(True), 'raw', 'BGRX', 0, 1).copy()
        finally:
            memory_dc.SelectObject(previous_bitmap)
            win32gui.DeleteObject(bitmap.GetHandle())
            memory_dc.DeleteDC()
            source_dc.DeleteDC()
            win32gui.ReleaseDC(window['handle'], source)
        draw = ImageDraw.Draw(image)
        wrapper = Desktop(backend='uia').window(handle=int(handle)).wrapper_object()
        for control in wrapper.descendants(depth=6)[:500]:
            try:
                if control.element_info.element.CurrentIsPassword or SENSITIVE.search(control.element_info.name):
                    rect = control.rectangle()
                    draw.rectangle([rect.left-left, rect.top-top, rect.right-left, rect.bottom-top], fill='black')
            except Exception:
                pass
        original = image.size
        image.thumbnail((1280, 900))
        output = io.BytesIO()
        image.save(output, format='PNG')
        return {'window': window, 'image': 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode(), 'width': image.width, 'height': image.height, 'original_width': original[0], 'original_height': original[1], 'coordinate_mapping': 'absolute = window origin + image coordinate * original/image size', 'verified': True}

    def page(self, page_id):
        page = self.pages.get(page_id)
        if not page or page.is_closed():
            raise ValueError('Unknown browser tab. Open or list tabs first.')
        self.allowed_url(page.url)
        return page

    def allowed_url(self, url):
        if url == 'about:blank':
            return
        value = urlparse(url)
        if not self.enabled or self.stopped.is_set():
            raise ValueError('Browser permission was revoked.')
        if not self.internet and value.hostname not in ['localhost', '127.0.0.1']:
            raise ValueError('External network access is disabled.')
        if value.scheme not in ['http', 'https'] or value.username or value.password or value.hostname not in self.domains:
            raise ValueError('This URL is outside the session domain allowlist.')

    def browser_snapshot(self, page, page_id):
        self.allowed_url(page.url)
        # Mask secret controls before extracting the accessibility tree.
        data = page.locator('body').aria_snapshot(timeout=5000)
        data = re.sub(r'(?im)^.*(?:password|passcode|api.?key|credit.?card|cvv).*$', '[sensitive control omitted]', data)
        return {'page_id': page_id, 'url': page.url, 'title': page.title(), 'accessibility': data[:16000], 'verified': True}

    def browser_action(self, name, args):
        if 'browser' not in self.allowed:
            raise ValueError('Browser control is not enabled for this session.')
        mutation = name not in ['browser.inspect', 'browser.tabs', 'browser.read']
        self.gate(mutation)
        if name == 'browser.open':
            self.allowed_url(args['url'])
            if not self.browser:
                from playwright.sync_api import sync_playwright
                self.playwright = sync_playwright().start()
                left, top, right, bottom = self.dock_work
                middle = left + (right - left) // 2
                self.browser = self.playwright.chromium.launch(headless=False, args=[f'--window-position={middle},{top}', f'--window-size={right-middle},{bottom-top}'])
                self.browser_context = self.browser.new_context(accept_downloads=False, service_workers='block', no_viewport=True)
                self.browser_context.set_default_timeout(5000)
                # Block WebSockets, which ordinary request routing does not cover.
                self.browser_context.route_web_socket('**/*', lambda socket: socket.close())
                def network(route):
                    try:
                        self.allowed_url(route.request.url)
                        if route.request.method not in ['GET', 'HEAD', 'OPTIONS']:
                            route.abort()
                        else:
                            route.continue_()
                    except Exception:
                        route.abort()
                self.browser_context.route('**/*', network)
            page = self.browser_context.new_page()
            page_id = uuid.uuid4().hex
            self.pages[page_id] = page
            session = self.browser_context.new_cdp_session(page)
            try:
                browser_window = session.send('Browser.getWindowForTarget')
                left, top, right, bottom = self.dock_work
                middle = left + (right - left) // 2
                session.send('Browser.setWindowBounds', {'windowId': browser_window['windowId'], 'bounds': {'windowState': 'normal'}})
                session.send('Browser.setWindowBounds', {'windowId': browser_window['windowId'], 'bounds': {'left': middle, 'top': top, 'width': right-middle, 'height': bottom-top}})
            finally:
                session.detach()
            page.goto(args['url'], wait_until='domcontentloaded')
            return self.browser_snapshot(page, page_id)
        if name == 'browser.tabs':
            return {'tabs': [{'page_id': key, 'url': page.url, 'title': page.title()} for key, page in self.pages.items() if not page.is_closed()]}
        page = self.page(args['page_id'])
        if name == 'browser.inspect':
            return self.browser_snapshot(page, args['page_id'])
        before = self.browser_snapshot(page, args['page_id'])
        if name == 'browser.navigate':
            self.allowed_url(args['url'])
            page.goto(args['url'], wait_until='domcontentloaded')
        elif name == 'browser.scroll':
            page.mouse.wheel(0, max(-2000, min(2000, int(args['pixels']))))
        elif name == 'browser.switch_tab':
            page.bring_to_front()
        else:
            if SENSITIVE.search(args.get('name', '')):
                raise ValueError('Sensitive fields require manual user entry.')
            locator = page.get_by_role(args['role'], name=args['name'], exact=True)
            if locator.count() != 1:
                raise ValueError('The locator is missing or ambiguous. Inspect again.')
            if name == 'browser.fill':
                if locator.get_attribute('type') == 'password':
                    raise ValueError('Password entry is unavailable to the agent.')
                locator.fill(args['text'])
                return {'verified': locator.input_value() == args['text'], 'observation': self.browser_snapshot(page, args['page_id'])}
            if name == 'browser.select':
                locator.select_option(args['value'])
                return {'verified': locator.input_value() == args['value'], 'observation': self.browser_snapshot(page, args['page_id'])}
            if name == 'browser.read':
                try:
                    text = locator.input_value()
                except Exception:
                    text = locator.inner_text()
                return {'text': text[:8000], 'verified': True}
            if name == 'browser.click':
                locator.click()
            else:
                raise ValueError('Unknown browser action.')
        observation = self.browser_snapshot(page, args['page_id'])
        expected = args.get('expected_text')
        verified = bool(expected and expected in observation['accessibility'] and expected not in before['accessibility']) or (name == 'browser.navigate' and page.url == args['url'])
        return {'verified': verified, 'observation': observation, 'verification_note': None if verified else 'Action dispatched; inspect the resulting page to verify the intended outcome.'}

    def execute(self, name, args):
        if name == 'control.shutdown':
            self.stop()
            if self.browser:
                self.browser.close()
            if self.playwright:
                self.playwright.stop()
            return {'verified': True}
        if name == 'control.start':
            allowed = args.get('applications', [])
            if not isinstance(allowed, list) or any(app not in [*APPS, 'browser'] for app in allowed):
                raise ValueError('Choose permitted applications explicitly.')
            domains = args.get('domains', [])
            if not isinstance(domains, list) or any(not isinstance(d, str) or not re.fullmatch(r'[a-zA-Z0-9.-]{1,253}', d) for d in domains):
                raise ValueError('Use exact hostnames in the browser allowlist.')
            access = args.get('workspaceAccess', 'none')
            root = args.get('workspace_root', '')
            if access not in ['none', 'read', 'write']:
                raise ValueError('Invalid workspace access grant.')
            if access != 'none' and (not root or not os.path.isabs(root) or not os.path.isdir(root)):
                raise ValueError('An explicit existing workspace is required.')
            internet = args.get('internet', False) is True
            if not internet and any(host not in ['localhost', '127.0.0.1'] for host in domains):
                raise ValueError('External domains require internet permission.')
            if domains and 'browser' not in allowed:
                raise ValueError('Domain access requires browser permission.')
            if not allowed and access == 'none':
                raise ValueError('No application or workspace access was selected.')
            if args.get('readonly', True) is not False and access == 'write':
                raise ValueError('Observe only cannot grant workspace writes.')
            profile = args.get('pointerProfile', 'normal')
            if profile not in POINTER_DURATIONS or not isinstance(args.get('screenshots', True), bool):
                raise ValueError('Invalid pointer profile or screenshot preference.')
            with self.input_lock:
                if getattr(self.operation, 'generation', self.generation) != self.generation:
                    raise ValueError('This queued authorization was cancelled by Stop.')
                self.release_errors = self.input.release_all()
                if self.release_errors:
                    raise ValueError('Held input could not be released; computer control stays off.')
                self.generation += 1
                self.operation.generation = self.generation
                self.snapshots.clear()
                self.allowed = set(allowed)
                self.workspace_root = os.path.realpath(root) if access != 'none' else ''
                self.workspace_access = access
                self.internet = internet
                self.domains = set(domains)
                self.readonly = args.get('readonly', True) is not False
                self.input.pointer_profile = profile
                self.screenshots = args.get('screenshots', True)
                self.dock_work = win32api.GetMonitorInfo(win32api.MonitorFromWindow(win32gui.GetForegroundWindow(), 2))['Work']
                self.stopped.clear()
                self.paused.clear()
                self.enabled = True
            return {'enabled': True, 'readonly': self.readonly, 'applications': allowed, 'emergency_stop': 'Ctrl+Alt+Shift+Escape or mouse to a screen corner'}
        self.gate()
        if name.startswith('browser.'):
            return self.browser_action(name, args)
        if name == 'desktop.get_windows':
            return {'windows': self.windows(), 'monitors': [dict(m) for m in mss.mss().monitors[1:]]}
        if name == 'desktop.get_active_window':
            active = self.window(win32gui.GetForegroundWindow(), False)
            if not active['allowed']:
                active['title'] = '(not permitted)'
            return active
        if name == 'desktop.get_mouse_position':
            x, y = self.input.position()
            return {'x': x, 'y': y, 'verified': True, 'verification_method': 'GetCursorPos'}
        if name == 'desktop.inspect_window':
            return self.inspect(args['handle'])
        if name == 'desktop.focus_window':
            return self.focus(args['handle'])
        if name in ['desktop.minimize_window', 'desktop.maximize_window', 'desktop.restore_window', 'desktop.close_window']:
            if name in ['desktop.maximize_window', 'desktop.restore_window']:
                return {'verified': True, 'window': self.dock_right(args['handle']), 'verification_method': 'GetWindowRect', 'note': 'Window fills the right workspace; the conversation remains on the left.'}
            with self.input_lock:
                self.gate(True)
                window = self.window(args['handle'])
                if name == 'desktop.close_window':
                    win32gui.PostMessage(window['handle'], 0x0010, 0, 0)
                else:
                    win32gui.ShowWindow(window['handle'], {'desktop.minimize_window': 6, 'desktop.maximize_window': 3, 'desktop.restore_window': 9}[name])
            self.stopped.wait(0.15)
            self.gate()
            exists = win32gui.IsWindow(window['handle'])
            if name == 'desktop.close_window':
                return {'verified': not exists, 'verification_method': 'IsWindow after WM_CLOSE', 'note': 'Unsaved-document prompts are not dismissed automatically.'}
            state = win32gui.GetWindowPlacement(window['handle'])[1]
            expected = {'desktop.minimize_window': 2, 'desktop.maximize_window': 3, 'desktop.restore_window': 1}[name]
            self.snapshots.clear()
            return {'verified': state == expected, 'window': self.window(window['handle']), 'verification_method': 'GetWindowPlacement'}
        if name == 'desktop.capture_screen':
            return self.capture(args['handle'])
        if name == 'desktop.open_application':
            self.gate(True)
            app = args['application']
            if app not in self.allowed or app not in APPS:
                raise ValueError('This application is not permitted.')
            existing = [w for w in self.windows() if w['process'] in PROCESSES[app]]
            if existing:
                placed = [self.dock_right(w['handle']) for w in existing]
                return {'verified': True, 'windows': placed, 'already_open': True, 'placement': 'right half of session monitor'}
            executable = next((p for p in APPS[app] if p.is_file()), None)
            if not executable:
                raise ValueError('The permitted application is not installed at a known location.')
            with self.input_lock:
                self.gate(True)
                subprocess.Popen([str(executable)], shell=False)
            deadline = time.monotonic() + 8
            previous_handles = None
            stable_since = time.monotonic()
            while time.monotonic() < deadline:
                self.gate(True)
                found = [w for w in self.windows() if w['process'] in PROCESSES[app]]
                handles = [(w['handle'], w['pid']) for w in found]
                if handles != previous_handles:
                    previous_handles, stable_since = handles, time.monotonic()
                if found and time.monotonic() - stable_since >= 0.4:
                    return {'verified': True, 'windows': [self.dock_right(w['handle']) for w in found], 'placement': 'right half of session monitor'}
                self.stopped.wait(0.08)
            raise ValueError('No application window appeared after launch.')
        if name == 'desktop.wait_for_element':
            deadline = time.monotonic() + min(10, args.get('timeout_ms', 3000)/1000)
            while time.monotonic() < deadline:
                result = self.inspect(args['handle'])
                found = [e for e in result['elements'] if e['control_type'] == args['control_type'] and e['name'] == args['name']]
                if len(found) == 1:
                    return {'verified': True, 'element': found[0], 'observation': result}
                self.stopped.wait(0.08)
                self.gate()
            raise ValueError('The requested element did not appear.')
        if name == 'desktop.approval_handoff':
            # Clicking Allow foregrounds the dashboard and can minimize the app.
            # Restore only the exact approved process, then reacquire its UIA
            # target; never clear a pause or stop here.
            self.gate(True)
            original = self.snapshots.get(args.get('snapshot_id'))
            if not original or time.monotonic() - original['created'] > 15 * 60:
                raise ValueError('The approved observation expired. Inspect the app and request approval again.')
            aged = time.monotonic() - original['created'] > 90
            if aged and any(args.get(key) is not None for key in ['x', 'y', 'from_x', 'from_y', 'to_x', 'to_y']):
                raise ValueError('The coordinate observation expired. Inspect the layout again; old coordinates cannot be renewed.')
            original_window = original['window']
            identity = None
            if args.get('element_id'):
                if args['element_id'] not in original['controls']:
                    raise ValueError('The approved control is no longer available. Inspect again.')
                identity = original['control_ids'].get(args['element_id'])
                if identity is None:
                    raise ValueError('The approved control identity could not be verified. Inspect again.')
            focused = self.focus(original_window['handle'], expected=original_window)
            observed = focused['observation']
            if aged and not self.unchanged_observation(original, self.snapshots[observed['snapshot_id']]):
                raise ValueError('The observed app, controls or editor contents changed while the model was responding. Inspect again before proposing input.')
            if args.get('x') is not None or args.get('y') is not None or args.get('from_x') is not None or args.get('to_x') is not None:
                if observed['window']['bounds'] != original_window['bounds']:
                    raise ValueError('The app moved while approval was open. Inspect the new layout before clicking.')
            refreshed = dict(args, snapshot_id=observed['snapshot_id'])
            if identity is not None:
                matches = [key for key, current_id in self.snapshots[observed['snapshot_id']]['control_ids'].items() if current_id == identity]
                if len(matches) != 1:
                    raise ValueError('The approved control changed during approval. Inspect and request approval again.')
                refreshed['element_id'] = matches[0]
            self.target(refreshed)
            return {'args': refreshed, 'verified': True}
        window, control = self.target(args)
        if name == 'desktop.read_element':
            if control is None:
                raise ValueError('Choose an observed element.')
            return {'text': self.text(control)[:8000], 'selected_text': self.selection_text(control), 'verified': True}
        self.gate(True)
        self.input_guard(window, args)
        before = self.snapshots[args['snapshot_id']]
        before_text = [item.get('text', item.get('name', '')) for _, item in before['controls'].values()]
        pointer = None
        if name == 'desktop.mouse_up':
            self.input.button_up(args.get('button', 'left'))
            return {'verified': args.get('button', 'left') not in self.input.buttons, 'verification_method': 'release owned injected button'}
        if name == 'desktop.key_up':
            self.input.key_up(args['key'])
            return {'verified': normalize_key(args['key']) not in self.input.keys, 'verification_method': 'release owned injected key'}
        if name == 'desktop.type_text':
            if control is None or control.element_info.control_type not in ['Edit', 'Document']:
                raise ValueError('Choose an observed, editable text control.')
            with self.input_lock:
                self.input_guard(window, args)
                control.set_focus()
            if not control.has_keyboard_focus():
                raise ValueError('Could not verify editor focus.')
            text = args['text']
            address_field = window['process'] == 'explorer.exe' and re.search(r'address|location|path', control.element_info.name, re.I)
            file_dialog = re.search(r'save as|open file|select file', window['title'], re.I)
            if address_field or file_dialog:
                if not self.workspace_root or self.workspace_access == 'none':
                    raise ValueError('File dialogs require an explicit workspace grant.')
                if file_dialog and re.search(r'save', window['title'], re.I) and self.workspace_access != 'write':
                    raise ValueError('Saving requires explicit workspace write permission.')
                if not os.path.isabs(text):
                    raise ValueError('File and address fields require a full path inside the permitted workspace.')
                try:
                    if os.path.commonpath([self.workspace_root, os.path.realpath(text)]).lower() != self.workspace_root.lower():
                        raise ValueError('That file path is outside the permitted workspace.')
                except ValueError:
                    raise ValueError('That file path is outside the permitted workspace.')
            used_value = False
            # Large text in an empty editor can use its real UIA Value pattern.
            # Slow keyboard fallback is bounded so it cannot outlive IPC limits.
            if len(text) > 400 and not args.get('replace') and not self.text(control):
                try:
                    with self.input_lock:
                        self.input_guard(window)
                        self.set_text_value(control, text)
                    used_value = True
                except Exception:
                    raise ValueError('This editor cannot receive a large text value through UI Automation. Use workspace file tools or input chunks of at most 400 characters.')
            if args.get('replace'):
                try:
                    with self.input_lock:
                        self.input_guard(window)
                        self.set_text_value(control, text)
                    used_value = True
                except Exception:
                    if len(text) > 400:
                        raise ValueError('Large replacement requires a working UI Automation Value pattern. Use workspace file tools instead.')
                    self.input.hotkey(['ctrl', 'a'], lambda: self.input_guard(window, args))
            if not used_value:
                if len(text) > 400:
                    raise ValueError('Keyboard insertion is limited to 400 characters per action. Use workspace file tools for long documents.')
                # Unicode SendInput pairs leave the clipboard untouched. Check
                # cancellation and focus before every character, not just a batch.
                def typing_guard():
                    self.input_guard(window)
                    if win32gui.GetForegroundWindow() != window['handle'] or not control.has_keyboard_focus():
                        self.stop()
                        raise ValueError('Focus changed during typing. Computer input stopped.')
                self.input.type_text(text, typing_guard)
            actual = self.text(control)
            expected = text.replace('\r\n', '\n').replace('\r', '\n')
            deadline = time.monotonic() + 0.75
            while expected not in actual.replace('\r\n', '\n').replace('\r', '\n') and time.monotonic() < deadline:
                self.gate()
                self.stopped.wait(0.05)
                actual = self.text(control)
            normalized_actual = actual.replace('\r\n', '\n').replace('\r', '\n')
            verified = expected == normalized_actual if args.get('replace') else expected in normalized_actual
            return {'verified': verified, 'verification_method': 'UIA editor text readback', 'actual_text': actual[:5000], 'observation': self.inspect(window['handle'])}
        if name in ['desktop.press_key', 'desktop.hotkey', 'desktop.key_down']:
            keys = [normalize_key(k) for k in (args.get('keys') or [args['key']])]
            effective = set(keys) | self.input.keys
            if any(k not in KEYS for k in keys) or len(keys) != len(set(keys)):
                raise ValueError('Unsupported or protected keyboard shortcut.')
            if {'ctrl', 'alt', 'delete'}.issubset(effective):
                raise ValueError('Secure desktop shortcuts require manual user control.')
            if ('win' in effective and (name == 'desktop.key_down' or not effective.issubset({'win', 'shift', 'left', 'right', 'up', 'down'}))):
                raise ValueError('Only window-positioning Windows shortcuts are supported; shell/security shortcuts stay manual.')
            if effective.intersection({'alt', 'ctrl'}) and effective.intersection({'r', 'l'}):
                raise ValueError('Shell/address-bar shortcuts are not allowed through desktop input. Use browser tools.')
            if name == 'desktop.key_down':
                self.input.key_down(keys[0], lambda: self.input_guard(window, args))
                return {'verified': True, 'verification_method': 'SendInput accepted owned key-down; application outcome not implied'}
            self.input.hotkey(keys, lambda: self.input_guard(window, args))
        elif name in ['desktop.click', 'desktop.double_click', 'desktop.right_click', 'desktop.move_mouse', 'desktop.hover', 'desktop.mouse_down', 'desktop.drag', 'desktop.scroll']:
            pointer = self.pointer_action(name, args, window, control)
            if name in ['desktop.move_mouse', 'desktop.hover']:
                return {'verified': pointer['verified'], 'pointer': pointer, 'verification_method': 'GetCursorPos at the validated target', 'observation': self.inspect(window['handle'])}
        else:
            raise ValueError('Unknown computer-control action.')
        observation = self.inspect(window['handle'])
        expected = args.get('expected_text')
        verified = bool(expected and not any(expected in text for text in before_text) and any(expected in e.get('text', e.get('name', '')) for e in observation['elements']))
        return {'verified': verified, 'pointer': pointer, 'observation': observation, 'verification_method': 'new expected text in UIA observation' if verified else 'dispatch only', 'verification_note': None if verified else 'Input was dispatched. The intended outcome still needs a postcondition check.'}


controller = Controller()
jobs = queue.Queue()


def worker():
    import pythoncom
    pythoncom.CoInitialize()
    while True:
        name, args, generation, event, result = jobs.get()
        started = time.perf_counter()
        try:
            controller.operation.generation = generation
            if generation != controller.generation and name != 'control.shutdown':
                raise ValueError('Queued action cancelled by Stop, pause or a new authorization.')
            result.update(ok=True, result=controller.execute(name, args))
        except Exception as error:
            controller.release_errors = controller.input.release_all()
            if isinstance(error, pyautogui.FailSafeException):
                controller.stop()
            elif 'Pointer intervention' in str(error):
                controller.pause()
            result.update(ok=False, error=str(error))
        finally:
            result['duration_ms'] = round((time.perf_counter()-started)*1000, 2)
            event.set()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode('utf8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if self.headers.get('Origin') or self.headers.get('Sec-Fetch-Site') or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            return self.reply(403, {'ok': False, 'error': 'Unauthorized IPC request.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 2 or size > 65536:
                raise ValueError('Request is too large or empty.')
            body = json.loads(self.rfile.read(size))
            name, args = body['name'], body.get('args', {})
            if not isinstance(args, dict):
                raise ValueError('Arguments must be an object.')
            if name in ['desktop.stop', 'control.stop']:
                controller.stop()
                return self.reply(200, {'ok': True, 'result': {'enabled': False, 'verified': True}})
            if name == 'control.shutdown':
                controller.stop()
                event, result = threading.Event(), {}
                jobs.put((name, args, controller.generation, event, result))
                event.wait(2)
                self.reply(200, {'ok': True, 'result': {'enabled': False}})
                threading.Timer(0.1, lambda: os._exit(0)).start()
                return
            if name == 'control.status':
                return self.reply(200, {'ok': True, 'result': {'enabled': controller.enabled, 'paused': controller.paused.is_set(), 'readonly': controller.readonly, 'applications': list(controller.allowed), 'computer': os.environ.get('COMPUTERNAME', 'Windows'), 'emergency_stop': 'Ctrl+Alt+Shift+Escape', 'protocol': 2, 'pointerProfile': controller.input.pointer_profile, 'screenshots': controller.screenshots, 'heldButtons': list(controller.input.buttons), 'heldKeys': list(controller.input.keys), 'releaseErrors': controller.release_errors}})
            if name in ['control.pause', 'control.resume']:
                if name.endswith('pause'):
                    controller.pause()
                else:
                    controller.paused.clear()
                return self.reply(200, {'ok': True, 'result': {'paused': controller.paused.is_set()}})
            event, result = threading.Event(), {}
            jobs.put((name, args, controller.generation, event, result))
            if not event.wait(30):
                controller.stop()
                return self.reply(408, {'ok': False, 'error': 'Action timed out. Control stopped; inspect before retrying.'})
            return self.reply(200 if result.get('ok') else 400, result)
        except Exception as error:
            return self.reply(400, {'ok': False, 'error': str(error)})


def emergency_hotkey():
    user32 = ctypes.windll.user32
    if not user32.RegisterHotKey(None, 1, 0x0001 | 0x0002 | 0x0004 | 0x4000, 0x1B):
        print(json.dumps({'warning': 'Emergency hotkey registration failed; Start Control is disabled.'}), flush=True)
        return
    hotkey_ready.set()
    from ctypes import wintypes
    message = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(message), None, 0, 0):
        if message.message == 0x0312:
            controller.stop()


hotkey_ready = threading.Event()
threading.Thread(target=worker, daemon=True).start()
threading.Thread(target=emergency_hotkey, daemon=True).start()
hotkey_ready.wait(2)
if not hotkey_ready.is_set():
    raise SystemExit('Emergency stop shortcut is unavailable. The companion refuses to enable control.')
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)


def parent_watch():
    while True:
        if PARENT and not psutil.pid_exists(PARENT):
            controller.stop()
            server.shutdown()
            return
        time.sleep(2)


threading.Thread(target=parent_watch, daemon=True).start()
print(json.dumps({'ready': True, 'port': server.server_port, 'protocol': 1, 'pid': os.getpid()}), flush=True)
server.serve_forever()
