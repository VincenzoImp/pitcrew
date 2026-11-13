import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, type AutocompleteProvider, fuzzyFilter } from "@earendil-works/pi-tui";

// `#` in the editor completes the repo's open GitHub issues (`#12 [open] Fix login`). The list is
// read with `gh` once per session, on the first `#`; outside a GitHub repo nothing changes.
// Follows pi's examples/extensions/github-issue-autocomplete.ts.

type Issue = { number: number; title: string };

/** The `#…` token just before the cursor, or undefined. */
export const issueToken = (before: string) => before.match(/(?:^|[ \t(])#([^\s#]*)$/)?.[1];

export function issueItems(issues: Issue[], query: string): AutocompleteItem[] {
  const item = (i: Issue): AutocompleteItem => ({ value: `#${i.number}`, label: `#${i.number}`, description: i.title });
  if (/^\d*$/.test(query)) return issues.filter((i) => String(i.number).startsWith(query)).slice(0, 20).map(item);
  return fuzzyFilter(issues, query, (i) => `${i.number} ${i.title}`).slice(0, 20).map(item);
}

export function issueCompletion(pi: ExtensionAPI, ctx: ExtensionContext) {
  let issues: Promise<Issue[]> | undefined;
  const load = () => (issues ??= pi.exec("gh", ["issue", "list", "--state", "open", "--limit", "100", "--json", "number,title"], { cwd: ctx.cwd, timeout: 5_000 })
    .then((r) => (r.code === 0 ? (JSON.parse(r.stdout) as Issue[]) : []))
    .catch(() => []));
  ctx.ui.addAutocompleteProvider((current: AutocompleteProvider): AutocompleteProvider => ({
    async getSuggestions(lines, line, col, options) {
      const token = issueToken((lines[line] ?? "").slice(0, col));
      const items = token === undefined ? [] : issueItems(await load(), token);
      if (options.signal.aborted || !items.length) return current.getSuggestions(lines, line, col, options);
      return { items, prefix: `#${token}` };
    },
    applyCompletion: (lines, line, col, item, prefix) => current.applyCompletion(lines, line, col, item, prefix),
    shouldTriggerFileCompletion: (lines, line, col) => current.shouldTriggerFileCompletion?.(lines, line, col) ?? true,
  }));
}
