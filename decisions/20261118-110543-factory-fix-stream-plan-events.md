---
scope: factory
summary: Stream responses accept plan events, so factory log works
why: The stream schema checked plan events as orders, so log failed and the plan never started.
date: 2026-11-18
tags: [factory, contracts, plans]
---

- `streamEventsResponseSchema` accepts order events and plan events.
- Plan events carry a plan id, which the order-only schema rejects with an invalid orderId.
- CLI feed keeps order events only, so `log` and `status` are unchanged.
- Regression test parses a plan event in the stream response.
