# Sendr — Conversational Crypto Payments on Monad

> **Send money as easily as sending a message.**

Sendr is a WhatsApp-style AI-powered payment application built on the Monad blockchain. It eliminates the complexity of traditional crypto payments by letting users send funds, manage groups, and automate financial actions through simple, natural language commands — no wallet addresses, no confusing interfaces, just conversation.

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [User Flow](#user-flow)
- [Architecture Overview](#architecture-overview)
- [Smart Contracts](#smart-contracts)
- [AI Layer](#ai-layer)
- [Tech Stack](#tech-stack)
- [Why Monad](#why-monad)
- [Roadmap](#roadmap)
- [Use Cases](#use-cases)
- [Security & Safety](#security--safety)
- [Team](#team)

---

## The Problem

Crypto payments today are broken for everyday users.

Despite billions of dollars flowing through blockchain networks daily, the experience of actually sending money to another person remains deeply unfriendly:

- **Wallet addresses are unreadable.** A string like `0x4e83...c2a1` is not how humans identify each other. One wrong character and funds are gone forever.
- **The UX is intimidating.** Gas fees, transaction confirmations, network selection, slippage settings — these concepts create a steep barrier for non-technical users who simply want to split a bill or pay back a friend.
- **No conversational interface exists.** Every other financial tool in people's daily lives — from WhatsApp to Venmo — uses simple, human-readable interactions. Crypto wallets do not.
- **Group payments are painful.** Splitting costs among multiple people requires manually repeating the same transaction multiple times, tracking each address, and hoping nothing goes wrong.

The result is that crypto payments remain a tool for the technically sophisticated, locked away from the billions of people who could genuinely benefit from fast, borderless, low-cost transactions.

---

## The Solution

Sendr bridges the gap between the power of blockchain payments and the simplicity of everyday messaging apps.

Instead of interacting with raw wallet infrastructure, users simply type what they want to do — just like sending a WhatsApp message. The AI understands the intent, resolves usernames to wallet addresses, presents a clear confirmation, and executes the transaction on Monad.

```
"Send $2,000 to @tolu"         → Single payment, executed instantly
"Split $10k among Friends"     → Batch payment to a named group
"Send $5k to @ada every Friday" → Recurring automated payment
```

Sendr makes crypto payments as simple as texting.

---

## Key Features

### 1. Wallet Connection & Identity

Users create their crypto wallet on their first visit. The wallet acts as the cryptographic backbone of their identity on Sendr — it is the source of truth for who they are and what they own. No new seed phrases, no new accounts to manage.

### 2. Username System

Every user claims a unique, human-readable username (e.g., `@tolu`, `@ada`, `@john`) that is permanently mapped to their wallet address on-chain.

- Usernames are **globally unique** — no two users can hold the same username
- Claims are **one-time and permanent** — once a username is registered, it belongs to that wallet
- Usernames are **human-readable** — they replace wallet addresses entirely in the Sendr experience
- The mapping is stored on-chain, making it **trustless and verifiable** by anyone

This system solves one of the most fundamental UX problems in crypto: you no longer need to know someone's wallet address. You just need their username.

### 3. AI Chat Interface

The core of Sendr is a WhatsApp-style chat interface powered by an AI agent. Users interact with the AI entirely in natural language — no menus, no forms, no complicated flows.

The AI is capable of:
- Understanding the **intent** behind a message ("send", "split", "create group", "automate")
- **Extracting parameters** such as amounts, usernames, and group names from casual phrasing
- **Handling ambiguity** gracefully by asking clarifying questions when a command is unclear
- **Confirming actions** before executing any transaction, giving users full control

The interface is intentionally familiar. If you have ever used WhatsApp, Telegram, or iMessage, you already know how to use Sendr.

### 4. Individual Payments

Users can send funds to any other Sendr user by simply typing a command. The AI parses the request, resolves the recipient's username to their wallet address, displays a clear confirmation card, and executes the transaction upon approval.

**Example commands:**
- `"Send $2,000 to @tolu"`
- `"Pay @ada $5k"`
- `"Transfer 10 USDC to @john"`

### 5. Group Creation & Management

Users can create named groups of friends, family, teammates, or any collection of people. Groups are created conversationally and stored so they can be reused across multiple transactions.

**Example commands:**
- `"Create group 'Friends' with @tolu, @ada, @john"`
- `"Add @chidi to the Friends group"`
- `"Remove @john from Family"`

Groups can be:
- Named and renamed
- Expanded with new members
- Reduced by removing members
- Queried (`"Who is in the Friends group?"`)

### 6. Group Payments

Once groups exist, sending money to all members is as simple as naming the group. The AI resolves all members, calculates the total cost, presents a preview, and executes batch transactions in a single interaction.

**Example commands:**
- `"Send $2,000 to everyone in Friends"`
- `"Split $10k among the Family group"`
- `"Pay each person in Work $500"`

For split payments, Sendr automatically calculates each person's share and handles the math — users never need to divide manually.

### 7. AI Automation (Advanced)

Sendr supports recurring and conditional payment automation. Users define rules in natural language, and the AI agent executes them automatically according to the defined schedule or condition.

**Example commands:**
- `"Send ₦5,000 to @tolu every Friday"`
- `"Pay rent to @landlord on the 1st of every month"`
- `"If I receive $20k, save half to my savings wallet"`

Automations are transparent and fully user-controlled. Users can list, pause, or cancel any active automation at any time through a simple chat command.

### 8. Safety & Confirmation Layer

No transaction in Sendr is ever executed without explicit user confirmation. Before every payment — individual, group, or automated — the system presents a structured preview that includes:

- Recipient name(s) and username(s)
- Exact amount per recipient
- Total amount being sent
- Network and estimated gas fee
- A clear confirm / cancel prompt

Additionally, Sendr includes behavioral checks that flag potentially suspicious activity, such as unusually large amounts, new recipients, or duplicate transactions within a short timeframe.

### 9. Social Layer

Payments in Sendr are social by nature. Users can attach notes and emoji to any payment, making the experience feel personal rather than transactional.

- **Payment notes:** `"Send $1k to @tolu for shawarma 🌯"`
- **Emoji reactions:** Recipients can react to incoming payments
- **Activity feed:** A running history of sent and received payments with notes and context

---

## How It Works

### Step 1 — User Types a Command
The user types a natural language message in the chat interface. This could be as simple as `"Send ₦2k to @ada"` or as nuanced as `"Split last night's dinner bill of ₦15k among the Friends group"`.

### Step 2 — AI Parses the Intent
The AI agent processes the message to extract:
- **Action:** Send, split, create group, automate, query
- **Amount:** Numeric value and currency
- **Recipients:** Usernames or group names
- **Conditions:** Timing, frequency, or triggers (for automations)

### Step 3 — Username Resolution
The AI queries the on-chain username registry smart contract to resolve each username to its corresponding wallet address. If a username does not exist, the user is notified before proceeding.

### Step 4 — Confirmation Prompt
A structured confirmation card is displayed in the chat. The user reviews all transaction details and either confirms or cancels.

### Step 5 — Transaction Execution
Upon confirmation, the smart contract executes the payment(s). For individual payments, this is a single transaction. For group payments, this is a batch transaction that distributes funds to all recipients in one on-chain call.

### Step 6 — Confirmation in Chat
The chat interface updates with a success message and a summary of the transaction, including a link to the on-chain receipt.

---

## User Flow

### Onboarding

```
1. User opens Sendr
2. Create their crypto wallet 
3. Claims a unique username (e.g., @tolu)
4. Username is registered on-chain, mapped to their wallet address
5. User lands on the AI chat interface — ready to send
```

### Sending to an Individual

```
User:  "Send $2k to @ada"

Sendr: Here's your payment summary:
       ┌────────────────────────────┐
       │ To:      @ada              │
       │ Amount:  $2,000            │
       │ Network: Monad             │
       │ Fee:     ~$0.002           │
       └────────────────────────────┘
       Confirm or Cancel?

User:  Confirm

Sendr: ✅ Done! $2,000 sent to @ada.
       View on explorer →
```

### Creating a Group

```
User:  "Create a group called Friends with @tolu, @ada, and @chidi"

Sendr: Got it! Creating group "Friends" with 3 members:
       • @tolu
       • @ada
       • @chidi
       Confirm?

User:  Yes

Sendr: ✅ Group "Friends" created with 3 members.
```

### Sending to a Group

```
User:  "Send $2k to everyone in Friends"

Sendr: Here's your payment summary:
       ┌────────────────────────────┐
       │ Group:   Friends (3 people)│
       │ Each:    $2,000            │
       │ Total:   $6,000            │
       │ Network: Monad             │
       │ Fee:     ~$0.003           │
       └────────────────────────────┘
       Confirm or Cancel?

User:  Confirm

Sendr: ✅ ₦2,000 sent to @tolu, @ada, and @chidi.
```

---

## Architecture Overview

Sendr is composed of three integrated layers:

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND LAYER                      │
│          WhatsApp-style React chat interface            │
│         Wallet connection (wagmi / WalletConnect)       │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│                      AI LAYER                           │
│       Natural language parsing & intent recognition     │
│       Command classification & parameter extraction     │
│       Confirmation generation & response formatting     │
└─────────────────────────────┬───────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────┐
│                  SMART CONTRACT LAYER                   │
│         Username Registry (on-chain name → address)    │
│         Payment Executor (single & batch transfers)     │
│         Group Registry (named group management)         │
│         Automation Engine (recurring/conditional txns)  │
└─────────────────────────────────────────────────────────┘
                              │
                      MONAD BLOCKCHAIN
```

---

## Smart Contracts

Sendr is powered by three core smart contracts deployed on Monad.

### Username Registry Contract

The Username Registry is responsible for maintaining the mapping between human-readable usernames and wallet addresses. It is the foundational identity layer of the entire Sendr system.

**Key responsibilities:**
- Accepting new username registration requests
- Enforcing global uniqueness — rejecting duplicate claims
- Storing the permanent `username → wallet address` mapping on-chain
- Providing a public lookup function for the AI layer to resolve usernames at payment time
- Emitting events on registration for indexing and analytics

**Design considerations:**
- Usernames are stored as lowercase hashed strings to prevent case-based duplicates (`@Tolu` and `@tolu` are treated as the same)
- Once claimed, a username cannot be transferred or re-registered to prevent squatting abuse
- The contract exposes a simple `resolve(username)` function that returns the wallet address

### Payment Executor Contract

The Payment Executor handles the actual movement of funds. It supports both single-recipient and multi-recipient (batch) transactions, enabling group payments to be completed in a single on-chain call.

**Key responsibilities:**
- Validating that the sender has sufficient balance before execution
- Executing single payments from sender to recipient
- Executing batch payments to multiple recipients in one transaction
- Emitting payment events with metadata (sender, recipients, amounts, notes)

**Design considerations:**
- Batch payments are processed atomically — either all transfers succeed or the entire batch reverts, preventing partial payments
- Payment notes are stored as event data (not on-chain storage) to minimize gas costs
- Gas optimization is a priority given the potential for high-frequency micropayments

### Group Registry Contract (or Off-Chain Index)

Groups can be stored either on-chain or in a performant off-chain index (such as a decentralized graph or a trusted server-side database) depending on the trade-off between decentralization and cost.

**Key responsibilities:**
- Storing named groups and their member lists
- Handling group creation, member addition, and member removal
- Providing group resolution for the AI layer during payment processing

---

## AI Layer

The AI layer is the brain of Sendr. It transforms unstructured human language into structured, executable payment instructions.

### Intent Classification

Every message is first classified into one of the following intent categories:

| Intent | Example |
|--------|---------|
| `SEND_INDIVIDUAL` | "Send ₦2k to @tolu" |
| `SEND_GROUP` | "Pay everyone in Friends ₦1k" |
| `SPLIT_PAYMENT` | "Split ₦9k among @tolu, @ada, @john" |
| `CREATE_GROUP` | "Create group Family with @mama, @papa" |
| `EDIT_GROUP` | "Add @chidi to Friends" |
| `AUTOMATE_PAYMENT` | "Send ₦5k to @tolu every Friday" |
| `QUERY` | "Who is in my Friends group?" |
| `CANCEL` | "Cancel that" |

### Parameter Extraction

Once intent is classified, the AI extracts all relevant parameters from the message:

- **Amount** — numeric value with currency parsing (`$2k` → `2000 USDC`, `0.1 USDC` → `0.1 USDC`)
- **Recipient(s)** — username handles extracted from the message
- **Group name** — named groups referenced in the command
- **Schedule** — timing and frequency for automated payments
- **Note** — optional payment description or emoji

### Ambiguity Handling

When a command is missing required information or is ambiguous, the AI asks a targeted clarifying question rather than guessing. This prevents accidental transactions.

```
User:  "Send money to @tolu"
Sendr: How much would you like to send to @tolu?
```

### Safety Checks

Before generating a confirmation prompt, the AI applies a set of safety heuristics:
- **Large amount warning:** Flags transactions above a configurable threshold for extra confirmation
- **New recipient notice:** Highlights when paying someone for the first time
- **Duplicate detection:** Warns if an identical transaction was executed recently
- **Unresolved username:** Notifies the user if a mentioned username does not exist on-chain

---


## Why Monad

Sendr is purpose-built for Monad because Monad's technical properties directly address the core requirements of a payment application at scale:

- **High throughput:** Monad's parallel execution enables thousands of transactions per second, making real-time group payments and automation viable without congestion
- **Low latency:** Near-instant transaction finality means users see their payments confirmed in seconds, not minutes
- **Low fees:** Micropayments — splitting a ₦500 snack or sending ₦200 for a bet — are only economically viable when transaction fees are negligible
- **EVM compatibility:** Full compatibility with Ethereum tooling (Solidity, ethers.js, Hardhat) accelerates development and enables ecosystem integrations
- **Emerging ecosystem:** Building on Monad early positions Sendr to grow alongside the ecosystem and capture a first-mover advantage in social payments on the network

---


## Use Cases

**Friends & Social Circles**
A group of friends goes out for dinner. One person pays. Later, someone types: `"Split ₦24,000 among Friends group"` and everyone's share is automatically sent in seconds.

**Roommates & Household Bills**
Housemates set up a recurring group automation: `"Split $80k rent among Apartment group on the 1st of every month"`. No more chasing people for payments.

**Small Businesses & Freelancers**
A freelancer gets paid for a project: `"Send $150k to @designer for logo work"`. The note is on-chain. The payment is instant. No bank transfers, no delays.

**Communities & DAOs**
A community manager distributes monthly stipends: `"Send $5k to everyone in Contributors group"`. One command, one confirmation, hundreds of payments.

**Savings Automation**
A user sets up a personal rule: `"Every time I receive money, save 20% to @my-savings"`. Financial discipline on autopilot.

---

## Security & Safety

Security is a first-class concern in Sendr, given that the application handles real financial transactions.

**Smart Contract Security**
- Contracts are designed to be minimal and auditable — no unnecessary complexity
- Batch payments are atomic — partial failures cause full reversals
- Re-entrancy guards on all payment functions
- Formal audit planned before mainnet launch

**AI Safety**
- No transaction is ever executed without explicit user confirmation
- The AI is instruction-following, not autonomous — it never initiates transactions on its own
- Large or unusual transactions trigger additional confirmation steps
- All AI decisions are logged for review and improvement

**User Safety**
- Usernames cannot be changed after registration, reducing impersonation risk
- Unresolved usernames are surfaced before any funds are prepared
- Users can review their full transaction history at any time
- Emergency pause mechanism on smart contracts for critical incidents

---


## License

MIT License — see [LICENSE](./LICENSE) for details.

---

*Built with ❤️ on Monad.*
