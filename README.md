# tinyclaw-infra

Infrastructure layer for [TinyClaw](https://github.com/TinyAGI/tinyclaw).

> This repo will be made public once TinyClaw's provider interfaces are ready.

## Overview

TinyClaw keeps its core simple on purpose. This repo builds on top of that,
solving the problems that show up when you try to run it seriously:

- Persistence — state and context survive restarts
- Security — control who talks to which agent, and audit what happened
- Deployment — containerized, reproducible, no manual tmux setup
- Stability — message delivery guarantees, crash recovery, graceful shutdown

And likely more down the road — monitoring, scaling, multi-node,
inter-agent encryption — as the needs come up.

TinyClaw works fine without this. This module is for when "fine" isn't enough.

## Status

Early stage. Tracking against a private fork of TinyClaw while the
interface boundaries are being worked out. **Waiting on TinyClaw to land its provider interfaces.
Expecting to open this repo by end of week, Feb 23 2026.**

## License

MIT
