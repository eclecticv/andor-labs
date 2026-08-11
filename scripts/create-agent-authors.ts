/**
 * One-time migration: create the `author` documents for the AI agents that write
 * the weekly newsletter, so a machine-written post can carry a machine byline
 * instead of borrowing a human one.
 *
 * Run with:
 *   npx sanity exec scripts/create-agent-authors.ts --with-user-token
 *
 * Idempotent: fixed `_id` + createOrReplace, same posture as create-author.ts,
 * so re-running refreshes these two documents rather than minting new
 * identities. There is no photo to upload — an agent has no face, and a stock
 * avatar on a machine byline would be a small lie in the same direction as a
 * human byline on machine text.
 *
 * EVERY line of the bios below is literally true and checkable. There are no
 * capabilities, no benchmarks, no personality, and no claims about how well
 * either model writes:
 *
 *   - it is a large language model
 *   - who makes it: Anthropic / OpenAI, which is also what `role` records
 *   - what it does here: drafts the newsletter
 *   - what a human does here: edits it before it publishes
 *
 * `kind: "agent"` is the field the JSON-LD branches on, so these documents are
 * never emitted as schema.org Person. `sameAs` points at the maker's own page —
 * the closest thing to a canonical identity an agent has — and NOT at a model
 * card URL invented from the model name.
 */
import { getCliClient } from "sanity/cli";

const client = getCliClient({ apiVersion: "2026-07-01" });

/** Minimal Portable Text paragraph — the bio renders inside a card, not a page. */
function block(text: string, key: string) {
  return {
    _type: "block",
    _key: key,
    style: "normal",
    markDefs: [],
    children: [{ _type: "span", _key: `${key}-s0`, text, marks: [] }],
  };
}

interface AgentSeed {
  id: string;
  name: string;
  slug: string;
  role: string;
  maker: string;
  sameAs: string;
}

const AGENTS: AgentSeed[] = [
  {
    id: "author-claude-opus",
    name: "Claude Opus",
    slug: "claude-opus",
    role: "Claude Opus · Anthropic",
    maker: "Anthropic",
    sameAs: "https://www.anthropic.com/claude",
  },
  {
    id: "author-gpt-5",
    name: "GPT-5",
    slug: "gpt-5",
    role: "GPT-5 · OpenAI",
    maker: "OpenAI",
    sameAs: "https://openai.com",
  },
];

async function main() {
  for (const agent of AGENTS) {
    const doc = {
      _id: agent.id,
      _type: "author",
      name: agent.name,
      slug: { _type: "slug", current: agent.slug },
      kind: "agent",
      role: agent.role,
      bio: [
        block(
          `${agent.name} is a large language model made by ${agent.maker}. It drafts the And/or Labs AI newsletter; a human edits the draft before it is published.`,
          "bio-0",
        ),
      ],
      sameAs: [agent.sameAs],
    };

    await client.createOrReplace(doc);
    console.log(`✓ ${doc._id}  (${doc.name} — ${doc.role})`);
  }

  console.log(`\nDone. ${AGENTS.length} agent author documents are live.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
