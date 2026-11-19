# `factory-web-demo` — docs

Small Astro SSR page that shows the factory and lets the Supervisor resume or cancel work orders. It is a client of `apps/factory-server` and holds no state.

| Document             | Covers                                                              |
| :------------------- | :------------------------------------------------------------------ |
| [PLAN.md](./PLAN.md) | Pages, write actions, localhost auto-registration, security, config |

## Quick start

1. Start `apps/factory-server` (see [LOCAL-RUN.md](../../factory-server/docs/LOCAL-RUN.md)). It writes `web-demo.join` into its data dir.
2. Set `FACTORY_PROJECT_ID` and, if the server is not on loopback, `FACTORY_TOKEN`.
3. Run `pnpm --filter @repo/factory-web-demo dev` (dev) or `build` then `start` (prod). Default address: `http://127.0.0.1:4321`.

## Config

| Env                  | Default                 | Required                              |
| :------------------- | :---------------------- | :------------------------------------ |
| `FACTORY_URL`        | `http://127.0.0.1:7070` | no                                    |
| `FACTORY_PROJECT_ID` | none                    | yes                                   |
| `FACTORY_DATA_DIR`   | server default          | only for auto-register                |
| `FACTORY_TOKEN`      | none                    | only for a non-loopback `FACTORY_URL` |
| `HOST` / `PORT`      | `127.0.0.1` / `4321`    | no                                    |

The web demo does not talk to Cells. Its only write actions are `resume` and `cancel` on work orders.
