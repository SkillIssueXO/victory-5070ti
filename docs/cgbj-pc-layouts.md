# CGBJ PC controls

Add this table to `victory.toml` to enable rebindable keyboard and mouse controls. An absent table or `enabled = false` uses CGBJ's original input.

```toml
[controls]
enabled = true
# Use true when loading a boat or car checkpoint.
start_in_vehicle = false
```

| Input | On foot | Vehicle |
| --- | --- | --- |
| W / S | Move forward / back | Right / left trigger for throttle and brake |
| A / D | Move left / right | Steer left / right |
| Numpad 8 / 5 | | Lean forward / back on supported vehicles |
| Mouse | Look and aim | Look and aim |
| Left / right mouse | Right / left trigger | Right / left trigger |
| F | Y and switch layout | Y and switch layout |
| G | Switch layout | Switch layout |
| Space | X | Right bumper |
| Esc | Menu and release or recapture the cursor | Menu and release or recapture the cursor |

Mouse look uses raw input. Clicking the focused game window captures the cursor. Alt-Tab releases it. A click used to capture the cursor is consumed. The title assigns the actions to controller outputs and displays its Xbox prompts.

The fallback `vehicle_layout = "aircraft"` selects flight controls for the vehicle profile at launch. W/S control the triggers, A/D control the bumpers for yaw, and Numpad 8/5 and 4/6 send pitch and roll. Left click sends A and G sends the left-stick click for landing gear. F sends Y and changes between the on-foot and selected vehicle layouts. F9 and F10 are unbound by default. Flight actions are based on the donor's GTA V mappings and need in-game verification.

Override keys under `[controls.on_foot]`, `[controls.vehicle]`, or `[controls.aircraft]`. See [victory.example.toml](../victory.example.toml).

To test direct keyboard support, launch with `VICTORY_KEYS_AS_PAD=0`. Keyboard readings go to the game, and the stable controller only receives physical controller input and any separate diagnostic `VICTORY_PAD_KEYS` script. The test disables mouse emulation and logs input requests and changed readings.

The mapping engine, mouse handling and original defaults are adapted from [fxceless PR #577](https://github.com/fxceless/victory-fork/pull/577). The aircraft and bicycle bindings and native keyboard diagnostic are adapted from Claude's CGBJ controls patch. This port retains CGBJ's stable controller identity when a physical pad connects.
