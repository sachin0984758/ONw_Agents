---
name: game-ui-audio
description: Design readable game HUDs and menus, clear feedback, accessible controls, and responsive sound/audio behavior.
---

# Game UI and Audio

- Keep the immediate objective, controls, score/progress, and important state visible without covering play.
- Establish visual hierarchy and contrast; support keyboard navigation and smaller screens.
- Give actions feedback through more than color alone (text, shape, motion, or sound).
- Start browser audio only after a user gesture; include mute/volume controls and handle failed audio loading.
- Avoid excessive animation, screen shake, or competing sound cues. Respect reduced-motion preferences.
- Test UI with gameplay state changes and confirm menus do not leave input listeners or audio running after close/restart.
