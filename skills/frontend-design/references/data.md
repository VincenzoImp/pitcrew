# Data views

Dashboards, charts, tables and reports. A wrong number in a nice chart is worse than no chart.

## Data first

1. Read the schema and a sample before you chart. Count rows, empty values and duplicates, and
   find the date range and the units.
2. Write each metric as a query or a function you can run, and keep it next to the number: in the
   code that computes it, a tooltip, a footnote, or the report's appendix.
3. Check each headline number twice: once from its query, once by an independent recount
   (another query, or a short script over the raw data). Two different results is a finding: say
   which one is right and why before you show either.
4. Unknown is not zero. Show missing data as missing ("no data", a gap in the line), never as 0.
5. Say what the data covers: the time range, the filters, when it was taken.
6. For large raw data, filter and aggregate with code first (SQL, a script). Give an agent only
   the result, never the raw dump; a `scout` agent can summarise a wide data set in parallel.

## Choose the chart by the question

| Question | Chart |
| --- | --- |
| Change over time | line; a sparkline when small |
| Compare amounts | bars, sorted, from a zero baseline |
| Part of a whole | stacked bar; a pie only for two or three parts |
| Spread of values | histogram, or a strip plot for few points |
| Relation of two numbers | scatter |
| Exact values to look up | table: numbers right-aligned, units in the header |

- **The title states the finding** ("Sign-ups doubled after the price change"), not the field
  name ("signups_count").
- Label axes with their units. Label lines directly at their end instead of a legend far away.
- One strong colour for the main series, grey for context. Never rely on colour alone (see the
  accessibility checklist).
- No 3D, no dual axes that suggest a link that is not there, no truncated bar axes.
- Tables: sortable when there are more than a screen of rows; totals clearly apart; the same
  number of decimals in one column.

## Delivery

- **Inside a product**: the project's chart library and design tokens.
- **A one-off report or dashboard**: one self-contained HTML file with the data embedded as JSON
  and the time it was taken, written to a scratch folder outside the repo (or where the owner
  asks). Check it in a browser (the `browser-check` skill) before you hand it over.
- **A dashboard that refreshes**: a script that rebuilds it from the queries, and a note on how and
  when to run it, where the project keeps such notes.
