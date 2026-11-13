# Blindspot pass

Search for unknown unknowns: constraints or options nobody has thought of that could change the
plan. Look in the docs, the code and the tests, and in the documented limits and known failure
modes of every dependency the plan rests on (rate limits, quotas, size limits, consistency,
licences, platform support, deprecations). Explain each finding in plain words, rank by risk to the
plan, and say how to settle it cheaply.

```markdown
## Blindspot pass

### Highest-risk unknowns
1. <unknown>
   - Why it matters: <what breaks or changes in the plan>
   - Evidence: <doc, file, issue>
   - Cheap way to settle it: <a doc to read, a spike, a question to the owner>
   - Decided by: owner / agent / docs / prototype

### Assumptions that look safe
- <assumption>: why it is safe, and how to check it later

### Questions worth asking now
1. <one material question>
```
