import { writeFileSync } from "node:fs";
import { createFakeYnabServer } from "./src/integration/fake-ynab/server.js";
import { FakeYnabState } from "./src/integration/fake-ynab/state.js";
import { FakeBudgetBuilder } from "./src/integration/fake-ynab/builder.js";
import { seedStandardBudget } from "./src/integration/seed.js";

const state = new FakeYnabState();
seedStandardBudget(new FakeBudgetBuilder(state, "budget-1"));
const srv = await createFakeYnabServer(state);
writeFileSync(process.argv[2], srv.url);
process.stdout.write(`FAKE_URL=${srv.url}\n`);
setInterval(() => {}, 1 << 30);
