# Series X PC controls and fullscreen

This build combines the four-format water readback with keyboard and mouse input, borderless fullscreen, and the yellow FPS counter. The tested source is `88a9860c7a7d42d964e21f0eacf4087f837f7e8f` and the tested executable SHA-256 is `b980993fdcdd377fb3a331ed82dd71500ecf0b203719ea27e75f332906f2acdf`.

## Controls

| PC input | Action or controller input |
|---|---|
| Click inside the game | Capture and hide the mouse pointer |
| Mouse or I/J/K/L | Look around |
| F8 | Toggle mouse capture. Switching away also releases it. |
| F11 | Toggle borderless fullscreen |
| F7 | Switch between walking and driving modes |
| W/A/S/D on foot | Move |
| W/S in driving mode | Right/left trigger for throttle and brake or reverse |
| A/D in driving mode | Steer |
| Right/left mouse button on foot | Left/right trigger for aim and fire |
| F | Y for vehicle interaction |
| Space on foot / in driving mode | A / RB |
| Shift / R | X / B |
| Ctrl / V | Left / right stick click |
| E / arrows | D-pad Right / directions |
| Tab / Q | LB / RB |
| M / Esc | View / Menu |
| Enter / Backspace | A / B |

The game displays controller prompts. Set `VICTORY_PC_CONTROLS=1` before launch to use the mapping without a physical XInput pad. `VICTORY_PC_DRIVING=1` starts the mapping in driving mode for a vehicle checkpoint. `VICTORY_FULLSCREEN=1` starts fullscreen. The water replay used the four original formats `256x256f41,256x256f16,64x64f16,128x128f36` and `VICTORY_LATE_WAIT=0`.

## Verified on RTX 5070 Ti

The fullscreen window test matched the monitor dimensions and restored the window frame. All 15 GameInput tests passed. The Series X run confirmed fullscreen and driving mode at startup, captured the mouse on click, and received relative mouse movement. The title read the throttle as held from 21:37:44.647 to 21:37:53.356 UTC. The driving profile maps W to this trigger. The logs establish delivery of the input. Visible boat movement from that input remains unverified.

The run wrote a new versioned checkpoint and ended after about nine minutes with `0xc0000005`. It read address zero at `VCRUNTIME140.dll+0x1c45a`, with the same first two title return offsets as earlier boat crashes. The checkpoint has not been replayed. [Earlier four-format water report](https://github.com/SkillIssueXO/victory-5070ti/commit/01e119a219e2356295c7269d87d4a3485d75f03d)

AI-assisted testing. The report contains source identifiers and aggregate measurements only.
