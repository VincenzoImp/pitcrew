#!/usr/bin/env node
// Drive one pi session in RPC mode for live tests.
// Usage: node tests/live/drive.mjs '<json>' where json = { "args": [...pi args], "prompts": [...] }
// Prompts run in order. A prompt that starts with "/" is an extension command ("/skill:<name> …" runs a turn); "sleep <n>" waits n seconds.
// Prints one line per notify, status, tool call and assistant message (dispatched model, level, text).
// DRIVE_FULL=1 prints each assistant text whole, on one line.
// Confirm dialogs are answered with "confirm" from the json (default false); a choice takes the first option.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const { args = [], prompts = [], env = {}, confirm = false } = JSON.parse(process.argv[2] ?? "{}");
const pi = spawn("pi", ["--mode", "rpc", ...args], {
  env: { ...process.env, ...env },
  stdio: ["pipe", "pipe", "inherit"],
});
const waiting = new Map();
// Token use of the whole run: tokens sent (input + cache), output, and the size of the first request.
const usage = { requests: 0, sent: 0, output: 0, first: undefined, tools: {} };
let settled = () => {};

createInterface({ input: pi.stdout }).on("line", (line) => {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (record.type === "response") waiting.get(record.id)?.(record);
  if (record.type === "agent_settled") settled();
  if (/compact/.test(record.type ?? "")) console.log(`event ${record.type}${record.reason ? ` reason=${record.reason}` : ""}${record.result?.summary ? `: ${process.env.DRIVE_FULL ? record.result.summary.replace(/\s+/g, " ") : record.result.summary.slice(0, 300)}` : ""}`);
  if (record.type === "extension_ui_request" && record.method === "notify") {
    console.log(`notify[${record.notifyType ?? record.level ?? ""}]: ${record.message}`);
  }
  if (record.type === "extension_ui_request" && record.method === "setStatus") {
    console.log(`status ${record.statusKey ?? record.key}: ${record.statusText ?? record.text}`);
  }
  if (record.type === "extension_ui_request" && record.method === "confirm") {
    console.log(`confirm? ${record.title} | ${String(record.message).split("\n")[0]} -> ${confirm}`);
    pi.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: record.id, confirmed: confirm })}\n`);
  }
  // A choice takes the first option (ask_user puts the recommended one first); free text is cancelled.
  if (record.type === "extension_ui_request" && ["select", "input", "editor"].includes(record.method)) {
    const answer = record.method === "select" ? { value: record.options?.[0] } : { cancelled: true };
    console.log(`asked (${record.method}): ${record.title ?? ""} -> ${answer.value ?? "cancelled"}`);
    pi.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: record.id, ...answer })}\n`);
  }
  if (record.type === "tool_execution_end") {
    const out = JSON.stringify(record.result?.content ?? record.result ?? "").slice(0, 160);
    console.log(`tool ${record.toolName} error=${record.isError}: ${out}`);
  }
  if (record.type === "message_end" && record.message?.role === "custom") {
    console.log(`custom ${record.message.customType}: ${String(record.message.content).slice(0, 200)}`);
  }
  if (record.type === "message_end" && record.message?.role === "assistant") {
    const message = record.message;
    const u = message.usage ?? {};
    const sent = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
    usage.requests += 1;
    usage.sent += sent;
    usage.output += u.output ?? 0;
    usage.first ??= sent;
    for (const part of message.content ?? []) if (part.type === "toolCall") usage.tools[part.name] = (usage.tools[part.name] ?? 0) + 1;
    const text = (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("");
    const error = message.errorMessage ? ` error=${message.errorMessage}` : "";
    console.log(`assistant ${message.provider}/${message.model} thinking=${message.thinkingLevel}${error}: ${process.env.DRIVE_FULL ? text.trim().replace(/\s+/g, " ") : text.trim().slice(0, 200)}`);
  }
});

const send = (command) =>
  new Promise((resolve) => {
    waiting.set(command.id, resolve);
    pi.stdin.write(`${JSON.stringify(command)}\n`);
  });

let n = 0;
for (const message of prompts) {
  console.log(`> ${message}`);
  if (/^sleep \d+$/.test(message)) {
    await new Promise((resolve) => setTimeout(resolve, Number(message.slice(6)) * 1000));
    continue;
  }
  const done = new Promise((resolve) => (settled = resolve));
  const response = await send({ id: `p${++n}`, type: "prompt", message });
  if (!response.success) console.log(`failed: ${response.error}`);
  else if (!message.startsWith("/") || message.startsWith("/skill:")) await done; // a skill runs a turn
  else await new Promise((resolve) => setTimeout(resolve, 300));
}
const state = await send({ id: "state", type: "get_state" });
console.log(`state: model=${state.data?.model?.provider}/${state.data?.model?.id} thinking=${state.data?.thinkingLevel}`);
console.log(`usage: requests=${usage.requests} first=${usage.first} sent=${usage.sent} output=${usage.output} tools=${JSON.stringify(usage.tools)}`);
pi.stdin.end();
pi.kill();
