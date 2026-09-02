import assert from "node:assert/strict";
import test from "node:test";

import { findPhrase, matchBeat, matchBeats, stem, tokenize } from "../lib/beat-matching";
import type { BeatDefinition } from "../lib/beat-matching";

const buzz: BeatDefinition = {
  id: "buzz",
  name: "Buzz",
  kind: "entity",
  terms: [
    { kind: "phrase", value: "Buzz" },
    // Deliberately specific. "agent" alone would corroborate "buzz" in any
    // article about agents, which is most of them.
    { kind: "anchor", value: "personal assistant" },
    { kind: "anchor", value: "on-device" },
    { kind: "negative", value: "Buzz Aldrin" },
    { kind: "domain", value: "buzz.example" },
  ],
};

const orchestration: BeatDefinition = {
  id: "orchestration",
  name: "Multi-agent orchestration",
  kind: "theme",
  terms: [
    { kind: "phrase", value: "multi-agent orchestration" },
    { kind: "anchor", value: "orchestration" },
    { kind: "anchor", value: "handoff" },
    { kind: "anchor", value: "subagent" },
    { kind: "negative", value: "orchestral" },
  ],
};

test("a conservative stem tolerates plurals and common verb endings", () => {
  assert.equal(stem("orchestrations"), "orchestration");
  assert.equal(stem("agents"), "agent");
  assert.equal(stem("orchestrating"), "orchestrat");
  assert.equal(stem("shipped"), "shipp");
  // Short words are left alone: stripping "ing" from "ring" leaves nothing useful.
  assert.equal(stem("ring"), "ring");
  assert.equal(stem("class"), "class");
});

test("a phrase matches across punctuation and light inflection", () => {
  const tokens = tokenize("We shipped multi agent orchestrations this week.");
  assert.equal(findPhrase(tokens, "multi-agent orchestration").length, 1);
});

test("an entity with nothing to confirm it is reported as low confidence", () => {
  const match = matchBeat(buzz, {
    title: "The buzz around the office was audible",
    body: "Everyone was talking.",
    url: "https://news.example/office",
  });
  // "Buzz" is an ordinary word. Matching it is not the same as finding the product.
  assert.equal(match?.confidence, "low");
  assert.match(match?.why ?? "", /nothing to confirm/);
});

test("an anchor near the name raises an entity to high confidence", () => {
  const match = matchBeat(buzz, {
    title: "Buzz adds a personal assistant mode",
    body: "The agent now runs on device.",
    url: "https://news.example/buzz",
  });
  assert.equal(match?.confidence, "high");
  assert.match(match?.why ?? "", /"Buzz" near "personal assistant"/);
});

test("a first-party domain is identity on its own", () => {
  const match = matchBeat(buzz, {
    title: "Release notes",
    body: "Version 2 is out.",
    url: "https://blog.buzz.example/release",
  });
  assert.equal(match?.confidence, "high");
  assert.match(match?.why ?? "", /buzz\.example/);
});

test("a negative term near the name rejects the match", () => {
  assert.equal(
    matchBeat(buzz, {
      title: "Buzz Aldrin on the agent revolution",
      body: "An assistant of a different kind.",
      url: "https://news.example/aldrin",
    }),
    null,
  );
});

test("a negative far from the name does not reject it", () => {
  // A long page may mention an unrelated sense of the word paragraphs away.
  const filler = "context ".repeat(120);
  const match = matchBeat(buzz, {
    title: "Buzz adds a personal assistant mode",
    body: `${filler} Separately, Buzz Aldrin was quoted.`,
    url: "https://news.example/buzz",
  });
  assert.equal(match?.confidence, "high");
});

test("a theme matches on its phrase", () => {
  const match = matchBeat(orchestration, {
    title: "A pattern for multi-agent orchestration",
    body: "Long body.",
    url: "https://example.com/a",
  });
  assert.equal(match?.confidence, "high");
});

test("a theme matches on two of its terms when no phrase appears", () => {
  // No literal string finds this reliably: "orchestrating agents with handoffs"
  // is the same subject written differently.
  const match = matchBeat(orchestration, {
    title: "Designing handoffs between subagents",
    body: "Each subagent hands off to the next.",
    url: "https://example.com/b",
  });
  assert.equal(match?.confidence, "medium");
  assert.match(match?.why ?? "", /handoff/);
});

test("one term alone is not a theme match", () => {
  assert.equal(
    matchBeat(orchestration, {
      title: "Notes on handoff design in APIs",
      body: "Nothing to do with agents.",
      url: "https://example.com/c",
    }),
    null,
  );
});

test("three terms make a theme match high confidence", () => {
  const match = matchBeat(orchestration, {
    title: "Orchestration, handoffs, and subagents",
    body: "All three ideas together.",
    url: "https://example.com/d",
  });
  assert.equal(match?.confidence, "high");
});

test("a theme's negative term rejects the whole item", () => {
  assert.equal(
    matchBeat(orchestration, {
      title: "Orchestral handoffs in the symphony",
      body: "The orchestration of strings and a handoff to brass.",
      url: "https://example.com/e",
    }),
    null,
  );
});

test("a match carries evidence a reader can judge without opening the link", () => {
  const match = matchBeat(buzz, {
    title: "Buzz adds a personal assistant mode",
    body: "The agent now runs on device, with no cloud round trip.",
    url: "https://news.example/buzz",
  });
  assert.match(match?.evidence ?? "", /Buzz adds a personal assistant mode/);
});

test("beats are returned strongest first", () => {
  // The theme's phrase is present, so it is certain. "buzz" appears as an
  // ordinary word with nothing near it to say which buzz is meant.
  const matches = matchBeats([buzz, orchestration], {
    title: "There is real buzz about multi-agent orchestration",
    body: "Teams are trying it.",
    url: "https://news.example/x",
  });
  assert.deepEqual(matches.map((match) => match.beatId), ["orchestration", "buzz"]);
  assert.equal(matches[0].confidence, "high");
  assert.equal(matches[1].confidence, "low");
});

test("an item with no text and no url matches nothing", () => {
  assert.equal(matchBeat(buzz, {}), null);
});
