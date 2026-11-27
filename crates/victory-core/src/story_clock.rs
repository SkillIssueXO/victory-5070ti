//! The menu sends a time request to the title's own clock update thread.

use std::sync::atomic::{AtomicU32, Ordering};

const NO_TIME: u32 = u32::MAX;
static CURRENT: AtomicU32 = AtomicU32::new(NO_TIME);
static REQUEST: AtomicU32 = AtomicU32::new(NO_TIME);

/// The last observed game time, in minutes since midnight.
pub fn current() -> Option<u32> {
    let minutes = CURRENT.load(Ordering::Relaxed);
    (minutes < 24 * 60).then_some(minutes)
}

/// Queues a change only after the engine has started advancing its clock.
pub fn request(minutes: u32) -> bool {
    minutes < 24 * 60
        && current().is_some()
        && REQUEST
            .compare_exchange(NO_TIME, minutes, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
}

pub fn observe(minutes: u32) {
    CURRENT.store(minutes, Ordering::Relaxed);
}

pub fn take_request() -> Option<u32> {
    let minutes = REQUEST.swap(NO_TIME, Ordering::Relaxed);
    (minutes < 24 * 60).then_some(minutes)
}
