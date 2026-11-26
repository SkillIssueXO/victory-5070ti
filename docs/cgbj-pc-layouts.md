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
| Mouse | Look and aim | Look and aim |
| Left / right mouse | Right / left trigger | Right / left trigger |
| F | Y and switch layout | Y and switch layout |
| G | Switch layout | Switch layout |
| Space | X | Right bumper |
| Esc | Menu and release or recapture the cursor | Menu and release or recapture the cursor |

Mouse look uses raw input. Clicking the focused game window captures the cursor. Alt-Tab releases it. A click used to capture the cursor is consumed. The title assigns the actions to controller outputs and displays its Xbox prompts.

The defaults cover the on-foot and vehicle layouts. Aircraft, bicycles, swimming, and parachute controls need their own gameplay verification. Override individual keys under `[controls.on_foot]` or `[controls.vehicle]` using the options in [victory.example.toml](../victory.example.toml).

The mapping engine, mouse handling and original defaults are adapted from [fxceless PR #577](https://github.com/fxceless/victory-fork/pull/577). This port retains CGBJ's stable controller identity when a physical pad connects.
