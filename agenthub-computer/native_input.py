"""Visible Windows input for the existing companion, not an independent runtime.

The caller owns target/scope validation. Every injection is guarded under the
same lock used by Stop. Only input injected by this object is ever released.
"""
import ctypes
from ctypes import wintypes
import threading
import time

ULONG_PTR = ctypes.c_size_t


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG),
                ('mouseData', wintypes.DWORD), ('dwFlags', wintypes.DWORD),
                ('time', wintypes.DWORD), ('dwExtraInfo', ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD),
                ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD),
                ('dwExtraInfo', ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [('uMsg', wintypes.DWORD), ('wParamL', wintypes.WORD), ('wParamH', wintypes.WORD)]


class INPUTUNION(ctypes.Union):
    _fields_ = [('mi', MOUSEINPUT), ('ki', KEYBDINPUT), ('hi', HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ('value',)
    _fields_ = [('type', wintypes.DWORD), ('value', INPUTUNION)]


USER32 = ctypes.WinDLL('user32', use_last_error=True)
USER32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
USER32.SendInput.restype = wintypes.UINT
USER32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
USER32.GetCursorPos.restype = wintypes.BOOL
USER32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
USER32.SetCursorPos.restype = wintypes.BOOL
USER32.GetAsyncKeyState.argtypes = [ctypes.c_int]
USER32.GetAsyncKeyState.restype = ctypes.c_short

POINTER_DURATIONS = {'fast': 0.08, 'normal': 0.35, 'demonstration': 1.0}
BUTTONS = {'left': (0x0002, 0x0004, 0x01), 'right': (0x0008, 0x0010, 0x02), 'middle': (0x0020, 0x0040, 0x04)}
KEYS = {'enter': 0x0D, 'tab': 0x09, 'esc': 0x1B, 'escape': 0x1B,
        'space': 0x20, 'backspace': 0x08, 'delete': 0x2E, 'insert': 0x2D,
        'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28,
        'home': 0x24, 'end': 0x23, 'pageup': 0x21, 'pagedown': 0x22,
        'shift': 0x10, 'ctrl': 0x11, 'alt': 0x12, 'win': 0x5B}
KEYS.update({chr(n): n - 32 for n in range(ord('a'), ord('z') + 1)})
KEYS.update({str(n): 0x30 + n for n in range(10)})
KEYS.update({f'f{n}': 0x6F + n for n in range(1, 25)})
EXTENDED = {'delete', 'insert', 'left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown', 'win'}


def normalize_key(key):
    value = str(key).lower()
    return {'control': 'ctrl', 'ctrlleft': 'ctrl', 'ctrlright': 'ctrl',
            'shiftleft': 'shift', 'shiftright': 'shift', 'altleft': 'alt',
            'altright': 'alt', 'winleft': 'win', 'winright': 'win',
            'return': 'enter'}.get(value, value)


class NativeInput:
    def __init__(self, lock=None):
        self.lock = lock or threading.RLock()
        self.buttons = set()
        self.keys = set()
        self.pointer_profile = 'normal'

    @staticmethod
    def position():
        point = wintypes.POINT()
        if not USER32.GetCursorPos(ctypes.byref(point)):
            raise OSError(ctypes.get_last_error(), 'Cannot read the Windows pointer position.')
        return point.x, point.y

    @staticmethod
    def _send(value):
        if USER32.SendInput(1, ctypes.byref(value), ctypes.sizeof(INPUT)) != 1:
            raise OSError(ctypes.get_last_error(), 'Windows refused input. Check desktop, focus and integrity level; no bypass is attempted.')

    @staticmethod
    def _mouse(flags, data=0):
        value = INPUT(type=0)
        value.mi = MOUSEINPUT(0, 0, data & 0xFFFFFFFF, flags, 0, 0)
        NativeInput._send(value)

    @staticmethod
    def _key(key, up=False):
        value = INPUT(type=1)
        value.ki = KEYBDINPUT(KEYS[key], 0, (0x0002 if up else 0) | (0x0001 if key in EXTENDED else 0), 0, 0)
        NativeInput._send(value)

    def move(self, x, y, guard, duration=None):
        duration = POINTER_DURATIONS[self.pointer_profile] if duration is None else duration
        if not 0 <= duration <= 2:
            raise ValueError('Pointer movement duration must be between 0 and 2 seconds.')
        origin = self.position()
        previous = origin
        started = time.monotonic()
        samples = [list(origin)]
        while True:
            fraction = 1.0 if duration == 0 else min(1.0, (time.monotonic() - started) / duration)
            point = (round(origin[0] + (x - origin[0]) * fraction), round(origin[1] + (y - origin[1]) * fraction))
            with self.lock:
                guard()
                actual = self.position()
                if max(abs(actual[0]-previous[0]), abs(actual[1]-previous[1])) > 3:
                    raise ValueError('Pointer intervention detected. Reobserve before continuing.')
                if not USER32.SetCursorPos(*point):
                    raise OSError(ctypes.get_last_error(), 'Windows refused pointer movement.')
                previous = self.position()
                if previous != point:
                    raise ValueError('Pointer is clipped or the display changed. Reobserve before continuing.')
            if len(samples) < 32:
                samples.append(list(previous))
            if fraction >= 1:
                break
            time.sleep(0.012)
        return {'from': list(origin), 'to': list(previous), 'samples': samples,
                'duration_ms': round((time.monotonic()-started)*1000, 2),
                'method': 'GetCursorPos / SetCursorPos', 'verified': previous == (x, y)}

    def button_down(self, button, guard):
        if button not in BUTTONS:
            raise ValueError('Unsupported mouse button.')
        with self.lock:
            guard()
            if button in self.buttons:
                raise ValueError('This button is already held by automation.')
            if USER32.GetAsyncKeyState(BUTTONS[button][2]) & 0x8000:
                raise ValueError('The user is holding this mouse button. Wait for release.')
            self._mouse(BUTTONS[button][0])
            self.buttons.add(button)

    def button_up(self, button):
        with self.lock:
            if button in self.buttons:
                self._mouse(BUTTONS[button][1])
                self.buttons.remove(button)

    def click(self, button, count, guard):
        for index in range(count):
            self.button_down(button, guard)
            try:
                time.sleep(0.025)
            finally:
                self.button_up(button)
            if index + 1 < count:
                time.sleep(0.065)

    def scroll(self, clicks, guard):
        with self.lock:
            guard()
            self._mouse(0x0800, int(clicks)*120)

    def key_down(self, key, guard):
        key = normalize_key(key)
        if key not in KEYS:
            raise ValueError('Unsupported key.')
        with self.lock:
            guard()
            if key in self.keys:
                raise ValueError('This key is already held by automation.')
            if USER32.GetAsyncKeyState(KEYS[key]) & 0x8000:
                raise ValueError('The user is holding this key. Wait for release.')
            self._key(key)
            self.keys.add(key)

    def key_up(self, key):
        key = normalize_key(key)
        with self.lock:
            if key in self.keys:
                self._key(key, True)
                self.keys.remove(key)

    def hotkey(self, keys, guard):
        pressed = []
        try:
            for key in keys:
                key = normalize_key(key)
                self.key_down(key, guard)
                pressed.append(key)
        finally:
            for key in reversed(pressed):
                self.key_up(key)

    def type_text(self, text, guard):
        for char in text.replace('\r\n', '\n').replace('\r', '\n'):
            if char in ('\n', '\t'):
                self.hotkey(['enter' if char == '\n' else 'tab'], guard)
            else:
                encoded = char.encode('utf-16-le')
                values = []
                for index in range(0, len(encoded), 2):
                    unit = int.from_bytes(encoded[index:index+2], 'little')
                    for flags in (0x0004, 0x0004 | 0x0002):
                        value = INPUT(type=1)
                        value.ki = KEYBDINPUT(0, unit, flags, 0, 0)
                        values.append(value)
                array = (INPUT * len(values))(*values)
                with self.lock:
                    guard()
                    if USER32.SendInput(len(values), array, ctypes.sizeof(INPUT)) != len(values):
                        raise OSError(ctypes.get_last_error(), 'Windows refused Unicode input.')
            # Modern Notepad can coalesce excessively rapid VK_PACKET messages.
            time.sleep(0.06)

    def release_all(self):
        errors = []
        with self.lock:
            for button in list(self.buttons):
                try:
                    self.button_up(button)
                except OSError as error:
                    errors.append(str(error))
            for key in list(self.keys):
                try:
                    self.key_up(key)
                except OSError as error:
                    errors.append(str(error))
        return errors
