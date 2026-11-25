//! Optional keyboard and mouse layout for the virtual gamepad.
use super::*;

const BUTTONS: &[(u8, u32)] = &[
    (0x1B, MENU),          // Escape
    (0x0D, A),             // Enter
    (0x08, B),             // Backspace
    (0x09, LEFT_SHOULDER), // Tab
    (b'M', VIEW),
    (b'F', Y),
    (b'R', B),
    (0xA0, X), // Shift
    (0xA1, X),
    (0xA2, LEFT_STICK), // Ctrl
    (0xA3, LEFT_STICK),
    (0x26, UP),
    (0x28, DOWN),
    (0x25, LEFT),
    (0x27, RIGHT),
    (b'E', RIGHT),
    (b'Q', RIGHT_SHOULDER),
    (b'V', RIGHT_STICK),
];

#[derive(Default)]
pub(super) struct Mouse {
    pub dx: i32,
    pub dy: i32,
    pub aim: bool,
    pub fire: bool,
}

#[derive(Clone, Copy)]
pub(super) struct Mode {
    pub focused: bool,
    pub driving: bool,
}

#[derive(Default)]
pub(super) struct Controls {
    active: bool,
    driving: bool,
    held: PadState,
    pressed: u32,
    last_read: Option<Instant>,
    pub output: PadState,
}

impl Controls {
    pub fn poll(&mut self, mode: Mode, keys: &[KeyState]) {
        if !mode.focused {
            *self = Self::default();
            return;
        }
        if self.driving != mode.driving {
            self.pressed = 0;
            self.output = PadState::default();
            self.last_read = None;
        }
        self.active = true;
        self.driving = mode.driving;
        let held = |vk| keys.iter().any(|key| key.virtual_key == vk);
        let on = |vk| f32::from(u8::from(held(vk)));
        let mut buttons = BUTTONS
            .iter()
            .filter(|(key, _)| held(*key))
            .fold(0, |all, (_, button)| all | button);
        if held(b' ') {
            buttons |= if self.driving { RIGHT_SHOULDER } else { A };
        }
        self.pressed |= buttons & !self.held.buttons;
        let previous = self.held;
        self.held = PadState {
            buttons,
            left_x: on(b'D') - on(b'A'),
            left_y: if self.driving {
                0.0
            } else {
                on(b'W') - on(b'S')
            },
            left_trigger: if self.driving { on(b'S') } else { 0.0 },
            right_trigger: if self.driving { on(b'W') } else { 0.0 },
            right_x: on(b'L') - on(b'J'),
            right_y: on(b'I') - on(b'K'),
        };
        if self.held != previous {
            self.last_read = None;
        }
    }

    pub fn refresh(&mut self, now: Instant) -> bool {
        if !self.active {
            return false;
        }
        let elapsed = self.last_read.map_or(POLL, |last| now.duration_since(last));
        if elapsed < POLL {
            return false;
        }
        self.last_read = Some(now);
        self.sample(elapsed, take_mouse());
        true
    }

    fn sample(&mut self, elapsed: Duration, mouse: Mouse) {
        let mut pad = self.held;
        pad.buttons |= std::mem::take(&mut self.pressed);
        // Map mouse velocity to the stick. Accumulation preserves motion
        // between game reads, and the offset clears the game's stick dead zone.
        let counts = elapsed.as_secs_f32().clamp(1.0 / 60.0, 0.5) * 2_000.0;
        let axis = |delta: i32| {
            if delta == 0 {
                0.0
            } else {
                (delta as f32).signum() * (0.2 + (delta as f32).abs() / counts).min(1.0)
            }
        };
        if mouse.dx != 0 {
            pad.right_x = axis(mouse.dx);
        }
        if mouse.dy != 0 {
            pad.right_y = -axis(mouse.dy);
        }
        if !self.driving {
            pad.left_trigger = f32::from(u8::from(mouse.aim));
            pad.right_trigger = f32::from(u8::from(mouse.fire));
        }
        self.output = pad;
    }
}

fn take_mouse() -> Mouse {
    #[cfg(windows)]
    return pc_mouse::take();
    #[cfg(not(windows))]
    Mouse::default()
}

pub(super) fn discard_mouse() {
    #[cfg(windows)]
    pc_mouse::discard();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(keys: &[u8]) -> Vec<KeyState> {
        keys.iter()
            .map(|&virtual_key| KeyState {
                virtual_key,
                ..Default::default()
            })
            .collect()
    }

    #[test]
    fn drive_mode_changes_w_and_s_without_firing_on_foot() {
        let mut controls = Controls::default();
        let foot = Mode {
            focused: true,
            driving: false,
        };
        let drive = Mode {
            focused: true,
            driving: true,
        };
        let walking = keys(b"WF ");
        controls.poll(foot, &walking);
        controls.sample(POLL, Mouse::default());
        assert_eq!(controls.output.left_y, 1.0);
        assert_eq!(controls.output.right_trigger, 0.0);
        assert_eq!(controls.output.buttons, Y | A);

        let driving = keys(b"WD ");
        controls.poll(drive, &driving);
        controls.sample(
            POLL,
            Mouse {
                aim: true,
                ..Default::default()
            },
        );
        assert_eq!(controls.output.left_x, 1.0);
        assert_eq!(controls.output.left_y, 0.0);
        assert_eq!(controls.output.left_trigger, 0.0);
        assert_eq!(controls.output.right_trigger, 1.0);
        assert_eq!(controls.output.buttons, RIGHT_SHOULDER);
        controls.poll(drive, &keys(b"S"));
        controls.sample(POLL, Mouse::default());
        assert_eq!(controls.output.left_trigger, 1.0);

        controls.poll(foot, &keys(b"W"));
        controls.sample(POLL, Mouse::default());
        assert_eq!(controls.output.left_y, 1.0);
        assert_eq!(controls.output.left_trigger, 0.0);
        assert_eq!(controls.output.right_trigger, 0.0);
    }

    #[test]
    fn short_action_and_mouse_motion_survive_a_slow_game_read() {
        let mut controls = Controls::default();
        let foot = Mode {
            focused: true,
            driving: false,
        };
        controls.poll(foot, &keys(b"F"));
        controls.poll(foot, &[]);
        let frame = Duration::from_millis(300);
        controls.sample(
            frame,
            Mouse {
                dx: 100,
                dy: -30,
                fire: true,
                ..Default::default()
            },
        );
        let output = controls.output;
        assert_eq!(output.buttons, Y);
        assert!(output.right_x > output.right_y && output.right_y > 0.2);
        assert_eq!(output.right_trigger, 1.0);
        controls.sample(frame, Mouse::default());
        assert_eq!(controls.output, PadState::default());
    }
}
