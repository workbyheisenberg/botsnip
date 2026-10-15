# Larper

Internal sniper console for **pons v2** launches on **Robinhood Chain** (chain id `4663`).

When one of your team's **launch wallets** creates a token on pons, Larper detects it the moment
it lands and buys a position with your **buying wallet** — untaxed, because your buying wallet is
on the launch's snipe-tax exemption list.

---

## The strategy, and why it's the one that works

pons is intentionally hostile to sniping:

- **v1**: only the creator's own buy can execute in the launch block; then per-wallet caps.
- **v2**: buyers pay an opening **snipe tax — 99%, decaying to ~0 over 5 seconds**.

But both versions **exempt the launching wallet**, and v2 lets a creator name **up to 32 extra
wallets** that buy tax-free from the first instant.

So Larper targets the case the protocol actually rewards: **your own launch**. Larper watches your
launch wallet(s) and, on a match, fires a `buy()` against the launch curve with your buying
wallet. Because that wallet is exempt, there's no opening tax.

> If a buying wallet is **not** exempt on a launch, the snipe tax would apply. Larper detects
> this and **refuses the buy** rather than pay 99%. You'll see a "Buy REFUSED — snipe tax would
> apply" entry in Activity.

**Best path — built in:** for launches you create, use the **Launch** screen. It calls pons's
atomic `launchAndBuy` router (`0xe33E…2948`) so the token is created **and** your first buy lands
in the same transaction — guaranteed first, guaranteed untaxed, immune to any race. All your
enabled buying wallets are added to the exemption list automatically.

---

## Quick start

```bash
# 1. install (Node 20+; built on Node 22)
npm install

# 2. configure
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
#   → set TEAM_PASSWORD (and optionally an RPC / MASTER_KEY)

# 3. run both the server and the console (dev)
npm run dev
#   Server  → http://localhost:8787
#   Console → http://localhost:5173
```

**Production (single process serving the built console):**

```bash
npm run build        # builds the web console into web/dist
npm start            # server serves the API + console on :8787
```

Sign in at `http://localhost:8787` with your `TEAM_PASSWORD` (default `changeme` — change it).

---

## Using the console

| Screen | What it does |
| --- | --- |
| **Console** | Master switch: Dry-run ⇄ Live, arm/disarm auto-buy, stats, setup checklist, recent activity, "Scan now". |
| **Launch** | Create a token **and** take the opening position in one atomic transaction. Preview first. |
| **Wallets** | Add/remove/enable the **launch wallets** you watch and the **buying wallets** that snipe, each with its own ETH amount. |
| **Activity** | Live feed of detections, buys, refusals and errors, with explorer links. |
| **Settings** | Buy size, slippage, snipe-tax tolerance, native-only, Telegram alerts, connection status, sign out. |

Start in **Dry-run** (the default). Larper logs *"would have bought X"* without spending anything.
Only switch to **Live** once you trust it.

---

## Launching from the console (atomic)

The **Launch** screen creates a token and buys it in one transaction via pons's `launchAndBuy`
router. Nothing can trade in between, so the opening buy can't be front-run.

- Fill in the token (name, symbol, description, logo, socials), pick a launch config, set the
  first-buy amount in ETH, and choose which wallet signs.
- **Preview** computes the plan without sending anything: total cost (launch fee + buy), expected
  tokens, min-out after slippage, and how many wallets will be exempt.
- **Launch atomically** sends the real transaction. It's only enabled when the console is in
  **Live** mode, and it asks for confirmation.
- The screen shows whether the signing wallet is currently allowed to launch (`canLaunch`); pons
  can gate public launches on and off.

> A brand-new launch has no pool yet, so the quote is computed deterministically from the launch
> config's opening price (phantom reserve), not from a market read.

## Bundling across several wallets

During the launch window each wallet can hold at most ~5% of supply. To take a bigger position,
Larper buys from **every enabled buying wallet**, each spending its own amount (set per wallet on
the **Wallets** screen). All of them are added to the exemption list automatically.

## Watching launches (the core)

Larper detects every pons launch by reading the factory's `TokenLaunched` event, then matches the
**deployer** against your watched wallets.

Two ways to watch:

- **Your wallets only** — add a launch wallet in **Wallets**. Only its launches trigger a
  notification (and, if armed, a buy).
- **Watch all launches** — toggle in **Settings → Protections**. Notifies on *every* launch on
  pons. **Monitor only — it never buys.** Handy for testing and for keeping an eye on the market.

Both paths feed **Activity** and, if enabled, **Telegram**.

## Testing detection

You don't have to wait for your own launch to prove it works.

**Option A — live (easiest).** Turn on **Watch all launches**, open **Activity**, and wait.
pons launches frequently, so a real detection (and Telegram ping) usually arrives within minutes.

**Option B — replay a real launch on demand.** Use **Console → Test detection**:

1. Add a wallet that has launched before in **Wallets** (any address works — it's read-only), or
   turn on **Watch all launches**.
2. Enter a block range in **Test detection** and hit **Replay range**.
3. Larper re-runs those blocks through the detector. Matches appear in Activity.
   **Replays are detection-only and never send a transaction.**

   A verified example range on Robinhood Chain:
   ```
   From block: 89391260
   To block:   89391280
   ```
   (a launch happened at block `89391270`; watch wallet `0x6caE1c6C5911af2594721d64E3FC57249b21e0F6`
   to see the "Launch detected from …" match)

**Option C — CLI backfill.**
```bash
npm --workspace server run scan-history -- 89360000 89391427
```

## Telegram alerts — setup

1. In Telegram, message **@BotFather** → `/newbot` → follow prompts. Copy the **bot token**
   (looks like `123456789:AAH…`).
2. **Send your new bot a message** (e.g. "hi") so a chat exists.
3. Get your **chat id**: open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and find
   `"chat":{"id":…}`. (For a group, the id is negative, e.g. `-1001234567890`.)
4. In Larper → **Settings → Telegram alerts**:
   - paste the **bot token** → **Save token**
   - enter the **chat id**
   - flip **Enable alerts** on
   - choose what to notify: detections, buys, skips/refusals, errors
5. Hit **Send test** — you should get a message in Telegram within a second or two.

The bot token is encrypted at rest, same as wallet keys. If **Send test** fails, the error text
tells you why (wrong token, wrong chat id, or you never messaged the bot).

### End-to-end test (detection → Telegram)

1. Settings → enable **Watch all launches** and **Telegram alerts** → **Send test** (confirms TG).
2. Console → **Test detection** → `89390000` to `89391427` → **Replay range**.
3. You should see **"Launch detected"** rows in Activity **and** matching Telegram messages.

That proves the whole chain: RPC → detector → activity → Telegram.

---

## If the RPC won't connect (important on some networks)

Some ISPs — including **Indonesian ISPs via the "Trust Positif" filter** — hijack the
Robinhood Chain RPC domain at the DNS level, resolving it to a block page. Symptom:

```
Head    block unreachable
```

Larper ships with a **DNS-over-HTTPS resolver** (on by default) that sidesteps this and reaches
the real endpoint. It falls back to the system resolver on any failure, so it's safe to leave on.

Knobs in `.env`:

```ini
DNS_OVER_HTTPS=true
DOH_RESOLVER_URL=https://cloudflare-dns.com/dns-query
```

If you'd rather use a different path, point Larper at any reachable RPC:

```ini
ROBINHOOD_RPC_URL=https://your-paid-provider/rpc?apikey=...
```

A paid provider (with a WebSocket endpoint in `ROBINHOOD_WS_URL`) is what makes sniping
competitive — the free public RPC is rate-limited and slow.

---

## Configuration (`.env`)

| Key | Meaning |
| --- | --- |
| `ROBINHOOD_RPC_URL` | HTTP RPC endpoint. Default: public Robinhood Chain RPC. |
| `ROBINHOOD_WS_URL` | Optional WebSocket endpoint (paid providers). |
| `PORT` | Server port (default `8787`). |
| `TEAM_PASSWORD` | Console password. **Change it.** |
| `MASTER_KEY` | Encrypts buying-wallet keys. Auto-generated if empty. |
| `POLL_INTERVAL_MS` | Chain poll interval (default `2000`). |
| `DNS_OVER_HTTPS` | Bypass DNS hijacking (default `true`). |
| `DOH_RESOLVER_URL` | DoH endpoint to use. |

---

## Safety

- **Use a burner buying wallet** with only the capital you're willing to risk. Its key lives on
  the server (encrypted at rest with AES-256-GCM via `MASTER_KEY`).
- **Dry-run is the default.** Live requires two switches: `mode = live` **and** auto-buy armed.
- **Never commit `.env`** or `server/data/` — both are git-ignored. Back up `server/data/.secrets.json`;
  without it, stored wallet keys can't be decrypted.
- This tool **executes fast; it does not guarantee profit.** Launch tokens are volatile and can go
  to zero.

---

## Project layout

```
bot-larper/
├─ server/                     # the bot + API
│  └─ src/
│     ├─ index.ts              # entrypoint (server + watcher)
│     ├─ chain.ts              # viem client, pons v2 addresses, ABIs
│     ├─ watcher.ts            # polls the factory for TokenLaunched events
│     ├─ trader.ts             # quotes + sends the curve buys (multi-wallet)
│     ├─ launcher.ts           # atomic launch + first buy
│     ├─ notify.ts             # Telegram alerts
│     ├─ quote.ts              # pons curve pricing math
│     ├─ doh.ts                # DNS-over-HTTPS resolver
│     ├─ store.ts              # JSON store (wallets, settings, activity)
│     ├─ crypto.ts             # key encryption + session signing
│     ├─ api.ts                # REST + SSE
│     └─ scripts/              # genkey, scan-history
└─ web/                        # React + Vite + Tailwind console
   └─ src/{pages,components,state,lib}
```

Useful scripts:

```bash
npm --workspace server run genkey                       # generate a MASTER_KEY
npm --workspace server run scan-history -- 89360000 89391427   # backfill check
```

---

## Reference — pons v2 contracts (Robinhood Chain, 4663)

| Contract | Address |
| --- | --- |
| Factory | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` |
| Launch-and-buy router | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` |
| Meme hook | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` |
| Fee escrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` |

Docs: `docs.ponsfamily.com/v2` · App: `ponsfamily.com` (be careful of lookalike domains).

---

## Roadmap

- [x] **Atomic launch + buy** via the `launchAndBuy` router (Launch screen).
- [x] **Multiple buying wallets per launch** (bundle across the 5% caps).
- [x] **Telegram alerts** on detection, buys, skips and errors.
- [ ] Confirm fills (receipt parsing) and post-buy price tracking.
- [ ] WebSocket subscription when `ROBINHOOD_WS_URL` is set.
- [ ] Auto-claim creator fees from the escrow.
