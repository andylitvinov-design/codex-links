import test from "node:test";
import assert from "node:assert/strict";

import {
  getReportHighlightLines,
  getReportSourceLinks
} from "../public/_lib/report-ui-utils.js";

test("getReportSourceLinks maps management dashboards to clickable URLs", () => {
  const links = getReportSourceLinks([
    "dashboard-thinking",
    "dashboard-execution-optimizer",
    "dashboard-daily-changes"
  ]);

  assert.deepEqual(links, [
    {
      id: "dashboard-thinking",
      label: "Agent 1",
      href: "https://brain-management.pages.dev/dashboard-thinking/"
    },
    {
      id: "dashboard-execution-optimizer",
      label: "Agent 2",
      href: "https://brain-management.pages.dev/dashboard-execution-optimizer/"
    },
    {
      id: "dashboard-daily-changes",
      label: "Daily Changes",
      href: "https://brain-management.pages.dev/dashboard-daily-changes/"
    }
  ]);
});

test("getReportHighlightLines preserves all meaningful highlight rows", () => {
  const lines = getReportHighlightLines({
    summary: "Agent 1 summary only",
    highlights: [
      "Agent 1: focus",
      "Agent 2: action",
      "Daily Changes: strongest item"
    ]
  });

  assert.deepEqual(lines, [
    "Agent 1: focus",
    "Agent 2: action",
    "Daily Changes: strongest item"
  ]);
});

test("getReportHighlightLines falls back to summary when highlights are absent", () => {
  const lines = getReportHighlightLines({
    summary: "Single summary",
    highlights: []
  });

  assert.deepEqual(lines, ["Single summary"]);
});
