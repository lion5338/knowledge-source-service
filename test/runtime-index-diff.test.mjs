import assert from "node:assert/strict";
import test from "node:test";

import { diffRuntimeIndexes } from "../src/lib/sources/runtime-index-diff.js";

test("diffRuntimeIndexes summarizes source, topic, and source ref changes", () => {
  const fromIndex = {
    sources: [{ source: "marble" }, { source: "learning_commons" }],
    topics: [
      {
        topic_key: "fraction_equivalence",
        topic_label: "Equivalent fractions",
        aliases: ["fraction"],
        keywords: ["equivalent"],
        mapping_status: "auto_mapped",
        retrieved_sources: [
          {
            source: "marble",
            topic_id: "marble_fraction",
            normalized_id: "marble:old",
            source_version: "v1",
            license: "ODbL",
          },
        ],
      },
      {
        topic_key: "rectangle_area",
        topic_label: "Rectangle area",
        aliases: [],
        keywords: [],
        mapping_status: "auto_mapped",
        retrieved_sources: [],
      },
    ],
  };
  const toIndex = {
    sources: [{ source: "marble" }, { source: "k12_dataset" }],
    topics: [
      {
        topic_key: "fraction_equivalence",
        topic_label: "Equivalent fractions",
        aliases: ["fraction", "same value"],
        keywords: ["equivalent"],
        mapping_status: "auto_mapped",
        retrieved_sources: [
          {
            source: "marble",
            topic_id: "marble_fraction",
            normalized_id: "marble:new",
            source_version: "v1",
            license: "ODbL",
          },
          {
            source: "k12_dataset",
            topic_id: "k12_fraction",
            normalized_id: "k12:fraction",
            source_version: "demo",
            license: "CC BY-NC-SA",
          },
        ],
      },
      {
        topic_key: "decimal_place_value",
        topic_label: "Decimal place value",
        aliases: [],
        keywords: [],
        mapping_status: "auto_mapped",
        retrieved_sources: [],
      },
    ],
  };

  const diff = diffRuntimeIndexes(fromIndex, toIndex);

  assert.deepEqual(diff.summary, {
    source_count_delta: 0,
    topic_count_delta: 0,
    source_ref_count_delta: 1,
  });
  assert.deepEqual(diff.sources, {
    added: ["k12_dataset"],
    removed: ["learning_commons"],
  });
  assert.deepEqual(diff.topics, {
    added: ["decimal_place_value"],
    removed: ["rectangle_area"],
    changed: ["fraction_equivalence"],
  });
});
