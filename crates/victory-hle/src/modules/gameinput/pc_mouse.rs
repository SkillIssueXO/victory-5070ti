//! Foreground raw mouse input for the optional PC controls.
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};

use windows_sys::Win32::Foundation::{
    ERROR_INSUFFICIENT_BUFFER, GetLastError, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM,
};
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, GetRegisteredRawInputDevices, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RID_INPUT, RIDEV_REMOVE, RIM_TYPEMOUSE, RegisterRawInputDevices,
};
use windows_sys::Win32::UI::WindowsAndMessaging as wm;

use super::pc::Mouse;
use super::{LazyLock, Mutex, lock};

const MOUSE_DEVICE_SIZE: u32 = size_of::<RAWINPUTDEVICE>() as u32;
const GENERIC_DESKTOP: u16 = 1;
const MOUSE_USAGE: u16 = 2;
const F7: WPARAM = 0x76;
const F8: WPARAM = 0x77;

#[derive(Default)]
struct Capture {
    window: usize,
    bounds: RECT,
    registered_here: bool,
    dx: i32,
    dy: i32,
    down: u32,
    pressed: u32,
    capture_click: bool,
}

impl Capture {
    fn buttons(&mut self, mut flags: u32) {
        if self.capture_click {
            flags &= !wm::RI_MOUSE_LEFT_BUTTON_DOWN;
            if flags & wm::RI_MOUSE_LEFT_BUTTON_UP != 0 {
                self.capture_click = false;
            }
        }
        // Raw button flags pair a down bit with the next higher up bit.
        let buttons = wm::RI_MOUSE_LEFT_BUTTON_DOWN | wm::RI_MOUSE_RIGHT_BUTTON_DOWN;
        let down = flags & buttons;
        self.pressed |= down;
        self.down = (self.down | down) & !(flags >> 1 & buttons);
    }

    fn sample(&mut self) -> Mouse {
        let buttons = self.down | std::mem::take(&mut self.pressed);
        Mouse {
            dx: std::mem::take(&mut self.dx),
            dy: std::mem::take(&mut self.dy),
            aim: buttons & wm::RI_MOUSE_RIGHT_BUTTON_DOWN != 0,
            fire: buttons & wm::RI_MOUSE_LEFT_BUTTON_DOWN != 0,
        }
    }
}

static CAPTURE: LazyLock<Mutex<Capture>> = LazyLock::new(|| Mutex::new(Capture::default()));
static DRIVING: LazyLock<AtomicBool> = LazyLock::new(|| {
    AtomicBool::new(std::env::var_os("VICTORY_PC_DRIVING").is_some_and(|value| value == "1"))
});

pub(super) fn driving() -> bool {
    DRIVING.load(Ordering::Relaxed)
}

pub(in super::super) fn enabled() -> bool {
    static ENABLED: LazyLock<bool> =
        LazyLock::new(|| std::env::var("VICTORY_PC_CONTROLS").as_deref() == Ok("1"));
    *ENABLED
}

pub(super) fn take() -> Mouse {
    let mut capture = lock(&CAPTURE);
    // SAFETY: plain foreground window query.
    if capture.window != 0 && unsafe { wm::GetForegroundWindow() } as usize == capture.window {
        return capture.sample();
    }
    Mouse::default()
}

pub(super) fn discard() {
    let mut capture = lock(&CAPTURE);
    capture.down = 0;
    capture.sample();
}

pub(super) fn keep_clipped() {
    let capture = lock(&CAPTURE);
    // SAFETY: plain foreground query.
    if capture.window == 0 || unsafe { wm::GetForegroundWindow() } as usize != capture.window {
        return;
    }
    let mut actual = RECT::default();
    let wanted = &capture.bounds;
    // SAFETY: the capturing window has the foreground and both rectangles are initialized.
    unsafe {
        if wm::GetClipCursor(&mut actual) == 0
            || (actual.left, actual.top, actual.right, actual.bottom)
                != (wanted.left, wanted.top, wanted.right, wanted.bottom)
        {
            wm::ClipCursor(wanted);
        }
    }
}

fn registered_mouse() -> Option<Option<RAWINPUTDEVICE>> {
    let mut count = 0;
    // SAFETY: null buffer asks for the count; the second buffer has that size.
    unsafe {
        if GetRegisteredRawInputDevices(null_mut(), &mut count, MOUSE_DEVICE_SIZE) == u32::MAX
            && GetLastError() != ERROR_INSUFFICIENT_BUFFER
        {
            return None;
        }
        if count == 0 {
            return Some(None);
        }
        let mut devices = vec![RAWINPUTDEVICE::default(); count as usize];
        let read =
            GetRegisteredRawInputDevices(devices.as_mut_ptr(), &mut count, MOUSE_DEVICE_SIZE);
        if read == u32::MAX {
            return None;
        }
        Some(
            devices.into_iter().take(read as usize).find(|device| {
                device.usUsagePage == GENERIC_DESKTOP && device.usUsage == MOUSE_USAGE
            }),
        )
    }
}

fn register(hwnd: HWND, flags: u32) -> bool {
    let mouse = RAWINPUTDEVICE {
        usUsagePage: GENERIC_DESKTOP,
        usUsage: MOUSE_USAGE,
        dwFlags: flags,
        hwndTarget: hwnd,
    };
    // SAFETY: one complete registration. RIDEV_REMOVE is used with null hwnd.
    unsafe { RegisterRawInputDevices(&mouse, 1, MOUSE_DEVICE_SIZE) != 0 }
}

fn unregister(hwnd: HWND) {
    if registered_mouse()
        .flatten()
        .is_some_and(|device| device.hwndTarget == hwnd && device.dwFlags == 0)
    {
        register(null_mut(), RIDEV_REMOVE);
    }
}

fn clip(hwnd: HWND) -> Option<RECT> {
    let mut client = RECT::default();
    // SAFETY: valid window and storage for the client rectangle.
    if unsafe { wm::GetClientRect(hwnd, &mut client) } == 0 {
        return None;
    }
    let mut top_left = POINT {
        x: client.left,
        y: client.top,
    };
    let mut bottom_right = POINT {
        x: client.right,
        y: client.bottom,
    };
    // SAFETY: initialized points and a valid window on this thread.
    unsafe {
        if ClientToScreen(hwnd, &mut top_left) == 0 || ClientToScreen(hwnd, &mut bottom_right) == 0
        {
            return None;
        }
        let x = top_left.x + (bottom_right.x - top_left.x) / 2;
        let y = top_left.y + (bottom_right.y - top_left.y) / 2;
        // Raw input remains relative even with the pointer held at one pixel.
        let bounds = RECT {
            left: x,
            top: y,
            right: x + 1,
            bottom: y + 1,
        };
        (wm::ClipCursor(&bounds) != 0).then_some(bounds)
    }
}

fn start(hwnd: HWND, clicked: bool) -> bool {
    let registered_here = match registered_mouse() {
        Some(None) if register(hwnd, 0) => true,
        Some(Some(device)) if device.hwndTarget == hwnd || device.hwndTarget.is_null() => false,
        _ => return false,
    };
    let Some(bounds) = clip(hwnd) else {
        if registered_here {
            unregister(hwnd);
        }
        return false;
    };
    *lock(&CAPTURE) = Capture {
        window: hwnd as usize,
        bounds,
        registered_here,
        // SAFETY: query only. A quick click may already have been released.
        capture_click: clicked && (unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON)) }) < 0,
        ..Capture::default()
    };
    // SAFETY: a null cursor hides it without changing ShowCursor's count.
    unsafe { wm::SetCursor(null_mut()) };
    true
}

fn stop(hwnd: HWND) {
    let capture = {
        let mut current = lock(&CAPTURE);
        if current.window != hwnd as usize {
            return;
        }
        std::mem::take(&mut *current)
    };
    // SAFETY: release our clip and restore the normal system cursor.
    unsafe {
        wm::ClipCursor(std::ptr::null());
        wm::SetCursor(wm::LoadCursorW(null_mut(), wm::IDC_ARROW));
    }
    if capture.registered_here {
        unregister(hwnd);
    }
}

fn mouse_input(hwnd: HWND, lparam: LPARAM) -> bool {
    let mut capture = lock(&CAPTURE);
    if capture.window != hwnd as usize {
        return false;
    }
    let mut raw = RAWINPUT::default();
    let mut size = size_of::<RAWINPUT>() as u32;
    // SAFETY: lparam is the WM_INPUT handle. The buffer is aligned and sized
    // for the header and a full raw mouse packet.
    let bytes = unsafe {
        GetRawInputData(
            lparam as _,
            RID_INPUT,
            (&mut raw as *mut RAWINPUT).cast(),
            &mut size,
            size_of::<RAWINPUTHEADER>() as u32,
        )
    };
    if bytes == size_of::<RAWINPUT>() as u32 && raw.header.dwType == RIM_TYPEMOUSE {
        // SAFETY: the header identifies the mouse union member.
        let (mouse, flags) = unsafe {
            (
                raw.data.mouse,
                raw.data.mouse.Anonymous.Anonymous.usButtonFlags,
            )
        };
        // Bit 0 denotes an absolute pointer, without relative mouse counts.
        if mouse.usFlags & 1 == 0 {
            #[cfg(feature = "diagnostics")]
            if mouse.lLastX != 0 || mouse.lLastY != 0 {
                static FIRST: std::sync::Once = std::sync::Once::new();
                FIRST.call_once(|| tracing::debug!("relative mouse input received"));
            }
            capture.dx = capture.dx.saturating_add(mouse.lLastX);
            capture.dy = capture.dy.saturating_add(mouse.lLastY);
        }
        capture.buttons(u32::from(flags));
        return capture.registered_here;
    }
    false
}

fn first_keydown(message: u32, lparam: LPARAM) -> bool {
    // WM_KEYDOWN bit 30 is set on autorepeat.
    message == wm::WM_KEYDOWN && lparam & (1 << 30) == 0
}

fn capture(hwnd: HWND, clicked: bool) -> bool {
    if start(hwnd, clicked) {
        tracing::info!(clicked, "captured the mouse for PC controls");
        true
    } else {
        tracing::warn!("could not capture the mouse for PC controls");
        false
    }
}

pub(in super::super) fn window_message(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> Option<LRESULT> {
    if !enabled() {
        return None;
    }
    match message {
        wm::WM_KEYDOWN | wm::WM_KEYUP if wparam == F7 || wparam == F8 => {
            if !first_keydown(message, lparam) {
                return Some(0);
            }
            // SAFETY: only accept shortcuts addressed to the foreground window.
            if unsafe { wm::GetForegroundWindow() } != hwnd {
                return Some(0);
            }
            if wparam == F7 {
                let driving = !DRIVING.fetch_xor(true, Ordering::Relaxed);
                tracing::info!(driving, "PC control mode");
            } else {
                let captured = lock(&CAPTURE).window == hwnd as usize;
                if captured {
                    stop(hwnd);
                    tracing::info!("released the mouse for PC controls");
                } else {
                    capture(hwnd, false);
                }
            }
            Some(0)
        }
        wm::WM_LBUTTONDOWN => {
            let uncaptured = lock(&CAPTURE).window == 0;
            // SAFETY: the click may have activated this client window.
            (uncaptured && unsafe { wm::GetForegroundWindow() } == hwnd && capture(hwnd, true))
                .then_some(0)
        }
        wm::WM_LBUTTONUP => {
            let mut capture = lock(&CAPTURE);
            if capture.window == hwnd as usize {
                capture.capture_click = false;
            }
            None
        }
        wm::WM_WINDOWPOSCHANGED => {
            let captured = lock(&CAPTURE).window == hwnd as usize;
            if captured {
                if let Some(bounds) = clip(hwnd) {
                    lock(&CAPTURE).bounds = bounds;
                } else {
                    stop(hwnd);
                }
            }
            None
        }
        wm::WM_KILLFOCUS | wm::WM_CANCELMODE | wm::WM_NCDESTROY | wm::WM_ENTERSIZEMOVE => {
            stop(hwnd);
            None
        }
        wm::WM_ACTIVATEAPP if wparam == 0 => {
            stop(hwnd);
            None
        }
        wm::WM_SYSCOMMAND if wparam & 0xFFF0 == wm::SC_CLOSE as usize => {
            stop(hwnd);
            None
        }
        wm::WM_INPUT if mouse_input(hwnd, lparam) => {
            // SAFETY: standard foreground WM_INPUT cleanup.
            Some(unsafe { wm::DefWindowProcW(hwnd, message, wparam, lparam) })
        }
        wm::WM_SETCURSOR
            if lparam as u16 == wm::HTCLIENT as u16 && lock(&CAPTURE).window == hwnd as usize =>
        {
            // SAFETY: a null cursor hides it while it is inside the client area.
            unsafe { wm::SetCursor(null_mut()) };
            Some(1)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_autorepeat_or_key_release_does_not_toggle_shortcuts() {
        assert!(first_keydown(wm::WM_KEYDOWN, 1));
        assert!(!first_keydown(wm::WM_KEYDOWN, 1 | (1 << 30)));
        assert!(!first_keydown(wm::WM_KEYUP, 1));
    }

    #[test]
    fn Windows_mouse_registration_round_trip() {
        assert!(matches!(registered_mouse(), Some(None)));
        assert!(register(null_mut(), 0));
        let found = registered_mouse().flatten();
        let removed = register(null_mut(), RIDEV_REMOVE);
        assert!(removed);
        assert!(found.is_some_and(|device| device.hwndTarget.is_null()));
        assert!(matches!(registered_mouse(), Some(None)));
    }

    #[test]
    fn quick_mouse_click_survives_until_the_title_reads() {
        let mut capture = Capture::default();
        capture.buttons(wm::RI_MOUSE_LEFT_BUTTON_DOWN);
        capture.buttons(wm::RI_MOUSE_LEFT_BUTTON_UP);
        capture.buttons(wm::RI_MOUSE_RIGHT_BUTTON_DOWN);
        capture.dx = 15;
        let first = capture.sample();
        assert!(first.fire && first.aim);
        assert_eq!(first.dx, 15);
        let next = capture.sample();
        assert!(!next.fire && next.aim);
        assert_eq!(next.dx, 0);
    }

    #[test]
    fn capturing_click_does_not_fire() {
        let mut capture = Capture {
            capture_click: true,
            ..Capture::default()
        };
        capture.buttons(wm::RI_MOUSE_LEFT_BUTTON_DOWN);
        assert!(!capture.sample().fire);
        capture.buttons(wm::RI_MOUSE_LEFT_BUTTON_UP);
        assert!(!capture.sample().fire);
        capture.buttons(wm::RI_MOUSE_LEFT_BUTTON_DOWN);
        assert!(capture.sample().fire);
    }
}
