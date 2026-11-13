import { Input, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Line } from "../../lib/rpc-child.ts";

// /agents: an overlay with every child of the session tree this process drives.
// List: one row per child (id, agent, model, state, tokens, last action). Enter opens a child.
// Child view: its live transcript; type a message and press Enter to steer it (a running child),
// answer it (a child that asks), or resume it (a finished child). Ctrl+X twice stops it.
// Ctrl+T hands an open question to the parent model. Esc goes back, then closes the panel.
// Closing stops nothing.
// Layout and keys follow the idea of tintinweb/pi-subagents' fleet list and conversation viewer (MIT).

export interface PanelRow {
  id: string;
  agent: string;
  model: string;
  status: string;
  tokens: string;
  last: string;
  question?: string;
}

export interface PanelSource {
  /** Rows, newest first. */
  rows(): PanelRow[];
  /** Transcript of one child: the last events of its stream. */
  transcript(id: string): Line[];
  /** Steer, answer or resume; returns a short notice. */
  send(id: string, text: string): Promise<string>;
  stop(id: string): string;
  /** Let the parent model answer the child's open question. */
  toModel(id: string): string;
  /** Called on every change; returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

const COLOR: Record<string, string> = {
  running: "warning", queued: "muted", asking: "accent", done: "success", stopped: "muted",
  failed: "error", timeout: "error", interrupted: "error",
};

export class AgentPanel {
  private selected = 0;
  private open?: string;
  private scroll = 0; // lines up from the bottom of the transcript
  private notice = "";
  private stopArmed = false;
  private input = new Input();
  private unsubscribe: () => void;
  private tui: any;
  private theme: any;
  private src: PanelSource;
  private done: () => void;

  constructor(tui: any, theme: any, src: PanelSource, done: () => void, focus?: string) {
    this.tui = tui;
    this.theme = theme;
    this.src = src;
    this.done = done;
    this.unsubscribe = src.subscribe(() => this.tui.requestRender());
    this.input.focused = true;
    if (focus) this.openChild(focus);
  }

  private openChild(id: string) {
    this.open = id;
    this.scroll = 0;
    this.notice = "";
    this.stopArmed = false;
    this.input.setValue("");
  }

  private close() {
    this.unsubscribe();
    this.done();
  }

  handleInput(data: string) {
    if (this.open) return this.childInput(data);
    const rows = this.src.rows();
    if (matchesKey(data, Key.escape) || data === "q") return this.close();
    if (matchesKey(data, Key.up)) this.selected = Math.max(0, this.selected - 1);
    else if (matchesKey(data, Key.down)) this.selected = Math.min(rows.length - 1, this.selected + 1);
    else if (matchesKey(data, Key.enter) && rows[this.selected]) this.openChild(rows[this.selected].id);
    this.tui.requestRender();
  }

  private childInput(data: string) {
    const id = this.open!;
    if (matchesKey(data, Key.ctrl("t"))) this.notice = this.src.toModel(id);
    else if (matchesKey(data, Key.ctrl("x"))) {
      if (this.stopArmed) { this.notice = this.src.stop(id); this.stopArmed = false; }
      else { this.stopArmed = true; this.notice = "press Ctrl+X again to stop this child"; }
    } else if (matchesKey(data, Key.escape)) {
      if (this.input.getValue()) this.input.setValue("");
      else this.open = undefined;
    } else if (matchesKey(data, Key.pageUp)) this.scroll += 10;
    else if (matchesKey(data, Key.pageDown)) this.scroll = Math.max(0, this.scroll - 10);
    else if (matchesKey(data, Key.enter)) {
      const text = this.input.getValue().trim();
      this.input.setValue("");
      if (text) {
        this.notice = "sending…";
        void this.src.send(id, text).then((n) => { this.notice = n; this.tui.requestRender(); });
      }
    } else {
      this.stopArmed = false;
      this.input.handleInput(data);
    }
    this.tui.requestRender();
  }

  /**
   * Lines padded to the full width, so the overlay hides what is under it, and always the same
   * number of them: pi centres an overlay by its height, so a panel that grew with the transcript
   * moved up the screen while the chat under it grew (#77).
   */
  render(width: number): string[] {
    return this.lines(width).map((l) => l + " ".repeat(Math.max(0, width - visibleWidth(l))));
  }

  private lines(width: number): string[] {
    const t = this.theme;
    const w = Math.max(20, width);
    const height = Math.max(10, Math.floor((this.tui.terminal?.rows ?? 40) * 0.85));
    const rule = (title: string) => truncateToWidth(t.fg("accent", `── ${title} ${"─".repeat(w)}`), w);
    const fit = (line: string) => truncateToWidth(line, w);
    const rows = this.src.rows();
    if (!this.open) {
      this.selected = Math.min(this.selected, Math.max(0, rows.length - 1));
      const out = [rule(`agents (${rows.length})`)];
      if (!rows.length) out.push(t.fg("muted", " No children in this session."));
      rows.forEach((r, i) => {
        const mark = i === this.selected ? t.fg("accent", "› ") : "  ";
        const state = t.fg(COLOR[r.status] ?? "text", r.status.padEnd(11));
        const last = r.question ? t.fg("accent", `asks: ${r.question}`) : t.fg("dim", r.last);
        out.push(fit(`${mark}${r.id.padEnd(14)} ${r.agent.padEnd(10)} ${state} ${t.fg("muted", r.model.padEnd(24))} ${r.tokens.padEnd(16)} ${last}`));
      });
      return [...pad(out, height - 1), t.fg("dim", fit(" ↑↓ select · Enter open · Esc close (children keep running)"))];
    }
    const row = rows.find((r) => r.id === this.open);
    const head = row ? `${row.id} · ${row.agent} · ${row.model} · ${row.status} · ${row.tokens}` : this.open;
    const style: Record<Line["kind"], (x: string) => string> = {
      user: (x) => t.fg("accent", `› ${x}`), assistant: (x) => x, tool: (x) => t.fg("muted", `→ ${x}`),
      result: (x) => t.fg("dim", `  ${x}`), error: (x) => t.fg("error", `✗ ${x}`),
    };
    const body = this.src.transcript(this.open).flatMap((l) =>
      l.text.split("\n").flatMap((part) => wrapTextWithAnsi(style[l.kind](part), w - 1)).map((x) => ` ${x}`));
    const room = height - 6;
    const end = Math.max(0, body.length - this.scroll);
    const shown = body.slice(Math.max(0, end - room), end);
    const action = row?.question ? "answer" : row && ["running", "queued"].includes(row.status) ? "steer" : "resume";
    const out = [rule(head)];
    if (row?.question) out.push(fit(t.fg("accent", ` asks: ${row.question}`)));
    out.push(...shown.map(fit));
    if (this.scroll) out.push(t.fg("dim", fit(` … ${this.scroll} lines below (PgDn)`)));
    const foot = [t.fg("muted", fit(` ${action}:`)), ...this.input.render(w - 2).map((l) => ` ${l}`),
      t.fg("dim", fit(` Enter ${action}${row?.question ? " · Ctrl+T let the model answer" : ""} · Ctrl+X Ctrl+X stop · PgUp/PgDn scroll · Esc back${this.notice ? ` · ${this.notice}` : ""}`))];
    return [...pad(out, height - foot.length), ...foot];
  }

  invalidate() {}
}

/** `lines` cut or filled with empty lines to exactly `n`. */
const pad = (lines: string[], n: number) => [...lines.slice(0, Math.max(0, n)), ...Array(Math.max(0, n - lines.length)).fill("")];
