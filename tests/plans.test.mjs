import test from "node:test";
import assert from "node:assert/strict";
import { planLabel, resolvePlanParam } from "../src/plans.ts";

test("plan labels localize known plans and use scraped names for dynamic plans", () => {
  const t = { planGo: "Go localized", planGoPlus: "Go Plus localized" };

  assert.equal(planLabel("go", t, "Scraped Go"), "Go localized");
  assert.equal(planLabel("go-plus", t, "Scraped Go Plus"), "Go Plus localized");
  assert.equal(planLabel("go-team", t, "Go Team"), "Go Team");
  assert.equal(planLabel("legacy-plan", t), "legacy-plan");
});

test("URL plan resolution accepts scraped dynamic ids and rejects unknown/default ids", () => {
  const scrapedPlans = [{ id: "go" }, { id: "go-teams" }];

  assert.equal(resolvePlanParam("go-teams", scrapedPlans), "go-teams");
  assert.equal(resolvePlanParam("not-a-plan", scrapedPlans), null);
  assert.equal(resolvePlanParam(null, scrapedPlans), null);
});
