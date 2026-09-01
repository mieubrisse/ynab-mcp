import { METHODOLOGY_CONTENT } from "./content.js";

export interface KnowledgeTopic {
  name: string;
  title: string;
  description: string;
  content: string;
}

const topics: ReadonlyArray<{
  name: string;
  title: string;
  description: string;
  file: string;
}> = [
  {
    name: "terminology",
    title: "YNAB Terminology and Core Concepts",
    description:
      "The Four Rules, milliunits, Ready to Assign, on-budget vs off-budget, Age of Money, transaction states, and budget months.",
    file: "terminology.md",
  },
  {
    name: "credit-cards",
    title: "YNAB Credit Card Handling",
    description:
      "How YNAB models credit card spending vs payments, the payment category, returns, pre-YNAB debt, and credit vs cash overspending on cards.",
    file: "credit-cards.md",
  },
  {
    name: "targets",
    title: "YNAB Targets",
    description:
      "Target types (Target Category Balance, Monthly Savings Builder, Needed for Spending), underfunded calculations, and target interactions with budgeting.",
    file: "targets.md",
  },
  {
    name: "overspending",
    title: "YNAB Overspending",
    description:
      "Cash vs credit overspending, month rollover behavior, hidden credit card debt, and how to cover overspending.",
    file: "overspending.md",
  },
  {
    name: "reconciliation",
    title: "YNAB Reconciliation",
    description:
      "Transaction status lifecycle (uncleared/cleared/reconciled), the reconciliation process, frequency recommendations, and API relevance.",
    file: "reconciliation.md",
  },
  {
    name: "api-quirks",
    title: "YNAB API Quirks and Limitations",
    description:
      "Known YNAB API limitations: scheduled transaction frequencies, split transaction handling and ID changes, scheduled-transaction date and split constraints.",
    file: "api-quirks.md",
  },
];

function loadTopic(topic: (typeof topics)[number]): KnowledgeTopic {
  // Content is compiled in rather than read from disk: this server runs with
  // no filesystem access at all, so a readFileSync here would be a permission
  // the sandbox deliberately does not grant.
  const content = METHODOLOGY_CONTENT[topic.name];
  if (content === undefined) {
    throw new Error(
      `Methodology topic '${topic.name}' has no inlined content. Re-run ` +
        "scripts/inline-methodology.mjs after adding its markdown file.",
    );
  }

  return {
    name: topic.name,
    title: topic.title,
    description: topic.description,
    content,
  };
}

export function getKnowledgeTopics(): KnowledgeTopic[] {
  return topics.map(loadTopic);
}
