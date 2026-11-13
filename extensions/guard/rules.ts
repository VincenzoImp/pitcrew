import { basename, dirname, isAbsolute, resolve, sep } from "node:path";

// Pure rules for the guard extension: given a tool call, return a verdict or undefined.
// "block" is never allowed; "ask" needs the user's yes (or PI_GUARD_ALLOW in headless runs).
// The parser is a heuristic, not a sandbox: it catches mistakes, not a determined adversary.
// Rules in NEVER_PREAPPROVE cannot be pre-approved with PI_GUARD_ALLOW (they disable the guard).

export interface Verdict {
  level: "block" | "ask";
  rule: string;
  reason: string;
}

export interface Place {
  cwd: string;
  /** Project root: the git top level of cwd, or cwd. */
  root: string;
  home: string;
  /** Directories where writes and deletes are always fine. */
  scratch: string[];
  /** Optional symlink resolver (realpath of the deepest existing prefix). Pure tests omit it. */
  real?: (path: string) => string;
}

export const NEVER_PREAPPROVE = new Set(["guard-bypass"]);

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh"]);
const INTERPRETERS = new Set([...SHELLS, "python", "python3", "node", "perl", "ruby", "php", "deno", "bun"]);
const RUNS_TEXT = new Set([...INTERPRETERS, "eval", "source", "."]);
const SYSTEM_DIRS = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/opt", "/proc", "/sbin", "/sys", "/usr", "/var", "/System", "/Library", "/Applications"];
const ELEVATE = new Set(["sudo", "doas", "su", "pkexec", "run0"]);
// Wrapper commands and their options that take a separate argument.
const WRAPPERS: Record<string, Set<string>> = {
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
  nice: new Set(["-n", "--adjustment"]),
  nohup: new Set(),
  time: new Set(["-o", "-f"]),
  command: new Set(),
  exec: new Set(["-a"]),
  xargs: new Set(["-I", "-n", "-P", "-d", "-a", "-L", "-s", "-E", "--max-args", "--max-procs", "--delimiter", "--arg-file"]),
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  stdbuf: new Set(["-i", "-o", "-e"]),
  ionice: new Set(["-c", "-n", "-p"]),
  chrt: new Set(),
  setsid: new Set(),
  unshare: new Set(["--propagation", "--setgroups", "--map-user", "--map-group", "--owner", "-S", "-G", "-R", "--root", "-w", "--wd"]),
};
const SUDO_ARG_OPTS = new Set(["-u", "-g", "-h", "-p", "-C", "-r", "-t", "-U", "-D", "--user", "--group"]);

// ---------------------------------------------------------------- secrets

const SECRET_SUFFIXES = [
  "/.pi/agent/auth.json", "/.claude/.credentials.json", "/.claude.json", "/.codex/auth.json",
  "/.aws/credentials", "/.config/gh/hosts.yml", "/.docker/config.json", "/.kube/config",
  "/.netrc", "/.pgpass", "/.npmrc", "/.pypirc", "/.git-credentials", "/.vault-token",
  "/.terraform.d/credentials.tfrc.json", "/.cargo/credentials", "/.cargo/credentials.toml", "/.gem/credentials",
  "/.cache/huggingface/token", "/.huggingface/token", "/.config/hub", "/etc/shadow", "/etc/gshadow",
];
const SECRET_DIRS = ["/.ssh", "/.aws", "/.gnupg", "/.password-store", "/.config/gcloud", "/.azure", "/.kube", "/.docker", "/.claude", "/.pi/agent", "/.codex", "/.config/gh", "/.local/share/keyrings"];
const SSH_PUBLIC = /^(.*\.pub|known_hosts(\.old)?|config|authorized_keys)$/;

/** Whether a resolved path looks like a credential file. */
export function isSecretPath(path: string): boolean {
  const name = basename(path);
  if (/^\.env(rc|\..+)?$/.test(name) && !/\.(example|sample|template|dist|defaults)(\.|$)/.test(name)) return true;
  if (/\.(pem|key|p12|pfx|keystore|jks|kdbx|tfstate)$/.test(name)) return true;
  if (/^\/proc\/(self|\d+)\/environ$/.test(path)) return true;
  if (path.includes(`${sep}.ssh${sep}`) && !SSH_PUBLIC.test(name)) return true;
  if (/\/\.(config\/gcloud|azure|gnupg|password-store)\//.test(path)) return true;
  return SECRET_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/** A directory whose contents are mostly credentials (or the whole home directory). */
function isSecretDir(path: string, place: Place): boolean {
  return path === place.home || SECRET_DIRS.some((d) => path === place.home + d);
}

// ---------------------------------------------------------------- paths

export function resolvePath(raw: string, place: Place): string | undefined {
  let p = raw.replace(/^['"]|['"]$/g, "");
  if (p === "~" || p.startsWith("~/")) p = place.home + p.slice(1);
  p = p.replace(/^\$\{?HOME\}?(?=\/|$)/, place.home).replace(/^\$\{?PWD\}?(?=\/|$)/, place.cwd);
  if (p.includes("$") || p.includes("`") || /^~[^/]/.test(p)) return undefined; // unresolvable
  return isAbsolute(p) ? resolve(p) : resolve(place.cwd, p);
}

const within = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const realOf = (path: string, place: Place) => (place.real ? place.real(path) : path);

export function isScratchOrProject(path: string, place: Place): boolean {
  // A session started in ~ or / has no project: everything outside scratch needs a yes.
  const hasProject = place.root !== place.home && place.root !== "/";
  const inside = (p: string) => (hasProject && within(p, place.root)) || place.scratch.some((dir) => within(p, dir));
  return inside(path) && inside(realOf(path, place));
}

/** Deleting this would take out the system, the home directory, or the project itself. */
function isCatastrophicTarget(path: string, place: Place): boolean {
  if (path === "/" || path === place.home || within(place.root, path)) return true;
  return SYSTEM_DIRS.some((dir) => path === dir) || within(place.home, path);
}

const inGitDir = (path: string) => path.split(sep).includes(".git");
const NOT_A_FILE = /^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/;

// ---------------------------------------------------------------- shell parsing

interface Segment {
  words: string[];
  /** Operator that joined this segment to the previous one ("|", "&&", ";", ...). */
  joinedBy: string;
  /** Started inside $(…), `…`, <(…) or >(…). */
  substituted: boolean;
  /** Body of a here-document attached to this segment. */
  heredoc?: string;
}

/** Split a command line into simple commands, honouring quotes and here-documents. */
export function splitCommands(line: string): Segment[] {
  const segments: Segment[] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let joinedBy = "";
  let substituted = false;
  let nextSubstituted = false;
  let quote: "'" | '"' | undefined;
  const pendingHeredocs: string[] = [];
  let heredoc: string | undefined;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = (op: string, sub = false) => {
    endWord();
    if (words.length) segments.push({ words, joinedBy, substituted, heredoc });
    words = [];
    heredoc = undefined;
    joinedBy = op;
    substituted = nextSubstituted || sub;
    nextSubstituted = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; inWord = true; continue; }
    if (c === "\\" && i + 1 < line.length) { word += line[++i]; inWord = true; continue; }
    if (c === "<" && line[i + 1] === "<" && line[i + 2] !== "<") {
      // Here-document: remember the delimiter; the body starts at the next newline.
      endWord();
      i += 2;
      if (line[i] === "-") i++;
      while (line[i] === " ") i++;
      let delim = "";
      while (i < line.length && !/[\s;|&<>()]/.test(line[i])) delim += line[i++];
      i--;
      pendingHeredocs.push(delim.replace(/['"\\]/g, ""));
      continue;
    }
    if (c === "\n" && pendingHeredocs.length) {
      const rest = line.slice(i + 1).split("\n");
      const bodies: string[] = [];
      let consumed = 0;
      for (const delim of pendingHeredocs.splice(0)) {
        const body: string[] = [];
        while (consumed < rest.length && rest[consumed].trim() !== delim) body.push(rest[consumed++]);
        consumed++; // the delimiter line
        bodies.push(body.join("\n"));
      }
      heredoc = bodies.join("\n");
      i += rest.slice(0, consumed).join("\n").length + (consumed > 0 ? 1 : 0);
      endSegment(";");
      continue;
    }
    if ((c === "<" || c === ">") && line[i + 1] === "(") { endSegment(";", true); i++; continue; }
    if (c === "$" && line[i + 1] === "(") { endSegment(";", true); i++; continue; }
    if (c === "`") { endSegment(";", !substituted); continue; }
    if (c === "\n" || c === ";" || c === "(" || c === ")") { endSegment(";"); continue; }
    if (c === "|" || c === "&") {
      const op = line[i + 1] === c ? c + c : c;
      i += op.length - 1;
      if (op === "&" && (line[i + 1] === ">" || line[i - 1] === ">")) { word += c; inWord = true; continue; }
      endSegment(op);
      continue;
    }
    if (c === " " || c === "\t") { endWord(); continue; }
    word += c;
    inWord = true;
  }
  endSegment(";");
  return segments;
}

/** Drop env assignments and wrapper commands; report elevation and guard-bypass assignments. */
export function commandWords(words: string[]): { argv: string[]; elevated: boolean; assigns: string[] } {
  let i = 0;
  let elevated = false;
  const assigns: string[] = [];
  while (i < words.length) {
    const w = words[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { assigns.push(w.split("=")[0]); i++; continue; }
    if (w === "{") { i++; continue; } // a brace group or a function body: `f() { rm -rf "$1"; }`
    const name = basename(w);
    if (ELEVATE.has(name)) {
      elevated = true;
      i++;
      while (i < words.length && words[i].startsWith("-")) i += SUDO_ARG_OPTS.has(words[i]) ? 2 : 1;
      continue;
    }
    if (name in WRAPPERS) {
      const withArg = WRAPPERS[name];
      i++;
      while (i < words.length && (words[i].startsWith("-") || /^\d+(\.\d+)?[smhd]?$/.test(words[i]))) {
        // `env -u PI_GUARD_STRICT pi …` drops the guard like an assignment does.
        if (name === "env" && (words[i] === "-u" || words[i] === "--unset")) assigns.push(words[i + 1] ?? "");
        else if (name === "env" && /^(-u|--unset=)./.test(words[i])) assigns.push(words[i].replace(/^(-u|--unset=)/, ""));
        i += withArg.has(words[i]) ? 2 : 1;
      }
      continue;
    }
    break;
  }
  return { argv: words.slice(i), elevated, assigns };
}

/** Separate redirections from arguments. */
function redirections(args: string[]): { args: string[]; writes: string[]; reads: string[] } {
  const out: string[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const m = /^(\d*|&)(>>?\|?|<)(.*)$/.exec(args[i]);
    if (!m) { out.push(args[i]); continue; }
    let target = m[3];
    if (!target) target = args[++i] ?? "";
    if (target.startsWith("&")) continue; // fd duplication such as 2>&1
    (m[2] === "<" ? reads : writes).push(target);
  }
  return { args: out, writes, reads };
}

const hasShortFlag = (args: string[], letter: string) => args.some((a) => /^-[A-Za-z]+$/.test(a) && a.includes(letter));
const has = (args: string[], ...flags: string[]) => args.some((a) => flags.includes(a));
const operands = (args: string[]) => args.filter((a) => !a.startsWith("-"));

// ---------------------------------------------------------------- bash rules

type Add = (level: Verdict["level"], rule: string, reason: string) => void;

/**
 * Verdict for a bash command line. `skip(verdict, segment)` drops a verdict of one simple command
 * (its index in splitCommands); the delivery rules use it to skip the usual ask inside the stop dial.
 */
export function checkBash(command: string, start: Place, depth = 0, skip?: (verdict: Verdict, segment: number) => boolean): Verdict | undefined {
  const segments = splitCommands(command);
  let place = start; // follows `cd` inside the command line
  const verdicts: Verdict[] = [];
  const at: number[] = []; // segment of each verdict; -1 for the whole line or a nested shell
  let current = -1;
  const add: Add = (level, rule, reason) => { verdicts.push({ level, rule, reason }); at.push(current); };

  checkLine(command, segments, start, add);

  const checkDelete = (target: string, recursive: boolean, verb: string) => {
    const path = resolvePath(target, place);
    if (!path) { if (recursive) add("ask", "rm-outside", `${verb} of an unresolved path: ${target}`); return; }
    if (recursive && isCatastrophicTarget(path, place)) add("block", "rm-catastrophic", `${verb} of ${path}`);
    else if (place.scratch.some((d) => path === d || dirname(path) === d && basename(target) === "*")) add("ask", "rm-outside", `${verb} of a whole temp directory: ${path}`);
    else if (!isScratchOrProject(path, place)) add("ask", "rm-outside", `${verb} outside the project: ${path}`);
    else if (inGitDir(path) || basename(path) === ".git") add("ask", "git-internals", `${verb} inside .git: ${path}`);
    if (isSecretPath(path)) add("ask", "secret", `deletes a credential file: ${path}`);
  };
  const checkWrite = (target: string, verb: string) => {
    if (NOT_A_FILE.test(target)) return;
    const path = resolvePath(target, place);
    if (!path) return; // $VAR targets: too common to ask about
    if (isSecretPath(path)) add("ask", "secret", `${verb} a credential file: ${path}`);
    else if (!isScratchOrProject(path, place)) add("ask", "write-outside", `${verb} outside the project: ${path}`);
    else if (inGitDir(path)) add("ask", "git-internals", `${verb} inside .git: ${path}`);
  };

  segments.forEach((segment, index) => {
    current = index;
    const { argv, elevated, assigns } = commandWords(segment.words);
    if (elevated) add("ask", "sudo", "runs with elevated privileges (sudo/doas/su/pkexec)");
    if (assigns.some((a) => a.startsWith("PI_GUARD"))) add("ask", "guard-bypass", "sets or unsets PI_GUARD_* for a child process");
    // A printed token lands in the model context and the session file.
    const secret = printsSecret(segment.words);
    if (secret) add("ask", "secret", secret);
    const automation = startsAutomation(argv);
    if (automation) add("ask", "publish", `${automation} starts unattended pushes, PRs or GitHub writes`);
    if (!argv.length) return;
    const cmd = basename(argv[0]);
    const { args, writes, reads } = redirections(argv.slice(1));
    for (const w of writes) checkWrite(w, "redirects into");
    for (const r of reads) { const p = resolvePath(r, place); if (p && isSecretPath(p)) add("ask", "secret", `reads a credential file: ${p}`); }

    if (cmd === "cd" || cmd === "pushd") {
      const dir = resolvePath(args.find((a) => !a.startsWith("-")) ?? "~", place);
      if (dir) place = { ...place, cwd: dir };
      return;
    }

    // Nested shells and here-documents fed to them: analyse the inner script too.
    if (depth < 3 && (SHELLS.has(cmd) || cmd === "eval")) {
      const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
      const script = cmd === "eval" ? args.join(" ") : flag >= 0 ? args[flag + 1] : segment.heredoc;
      if (script) { const inner = checkBash(script, place, depth + 1); if (inner) { verdicts.push(inner); at.push(-1); } }
    }

    // Downloaded or decoded content piped into an interpreter.
    if (INTERPRETERS.has(cmd) && segment.joinedBy === "|") {
      const pipeline = segments.slice(0, index + 1).reverse();
      const startIdx = pipeline.findIndex((s) => s.joinedBy !== "|");
      const upstream = pipeline.slice(1, startIdx === -1 ? undefined : startIdx + 1).map((s) => commandWords(s.words).argv);
      if (upstream.some((a) => ["curl", "wget"].includes(basename(a[0] ?? "")))) add("block", "pipe-to-shell", "pipes downloaded content into an interpreter; download, read, then run it");
      if (upstream.some((a) => (basename(a[0] ?? "") === "base64" && has(a, "-d", "--decode", "-D")) || (basename(a[0] ?? "") === "xxd" && has(a, "-r")))) {
        add("block", "pipe-to-shell", "pipes decoded content into an interpreter");
      }
    }

    switch (cmd.startsWith("mkfs.") ? "mkfs" : cmd) {
      case "rm": case "shred": case "unlink": case "rmdir": {
        const recursive = hasShortFlag(args, "r") || hasShortFlag(args, "R") || has(args, "--recursive");
        if (has(args, "--no-preserve-root")) add("block", "rm-root", "rm --no-preserve-root");
        const targets = operands(args);
        for (const target of targets) checkDelete(target, recursive || cmd === "shred", cmd === "rm" && recursive ? "recursive delete" : cmd);
        if (recursive && targets.some((a) => /^\.\*$|\/\.\*$/.test(a))) add("ask", "rm-outside", "recursive delete of .* matches .git and, in some shells, .. (the parent folder)");
        if (recursive && targets.some((a) => a === "*" || a === "/*") && (place.cwd === "/" || place.cwd === place.home)) {
          add("block", "rm-catastrophic", `recursive delete of * in ${place.cwd}`);
        }
        // Targets fed by xargs: fine only when an upstream `find` starts inside the project.
        if (recursive && !targets.length && segment.joinedBy === "|") {
          const finder = segments.slice(0, index).reverse().map((s) => commandWords(s.words).argv).find((a) => basename(a[0] ?? "") === "find");
          const from = finder ? resolvePath(operands(finder.slice(1))[0] ?? ".", place) : undefined;
          if (!from || !isScratchOrProject(from, place)) add("ask", "rm-outside", "recursive delete of piped paths");
        }
        break;
      }
      case "mv": {
        const ops = operands(args);
        const dest = has(args, "-t") ? args[args.indexOf("-t") + 1] : ops.pop();
        for (const src of ops) checkDelete(src, true, "move away");
        if (dest) checkWrite(dest, "moves into");
        break;
      }
      case "cp": case "install": case "rsync": case "ln": case "scp": {
        const ops = operands(args);
        const dest = has(args, "-t") ? args[args.indexOf("-t") + 1] : ops.pop();
        if (dest && !/^[^/]*:/.test(dest)) checkWrite(dest, `${cmd} into`);
        for (const src of ops) { const p = resolvePath(src, place); if (p && isSecretDir(p, place)) add("ask", "secret", `copies a credential directory: ${p}`); }
        break;
      }
      case "tee": for (const t of operands(args)) checkWrite(t, "tee into"); break;
      case "truncate": for (const t of operands(args).filter((a) => !/^\d/.test(a))) checkWrite(t, "truncates"); break;
      case "sed": case "perl":
        if (args.some((a) => /^-[a-z]*i/.test(a) || a === "--in-place")) for (const t of operands(args).slice(cmd === "sed" ? 1 : 1)) checkWrite(t, `${cmd} -i on`);
        break;
      case "tar": case "zip": case "7z": case "rclone":
        for (const t of operands(args)) { const p = resolvePath(t, place); if (p && isSecretDir(p, place)) add("ask", "secret", `archives a credential directory: ${p}`); }
        break;
      case "find": {
        const deletes = has(args, "-delete") || args.some((a, i) => (a === "-exec" || a === "-execdir") && ["rm", "shred"].includes(basename(args[i + 1] ?? "")));
        if (deletes) {
          const from = args.find((a) => !a.startsWith("-"));
          const path = from ? resolvePath(from, place) : place.cwd;
          if (path && isCatastrophicTarget(path, place)) add("block", "rm-catastrophic", `find deletes under ${path}`);
          else if (!path || !isScratchOrProject(path, place)) add("ask", "rm-outside", `find deletes outside the project: ${from}`);
          else if (inGitDir(path) || basename(path) === ".git") add("ask", "git-internals", `find deletes inside .git: ${path}`);
        }
        break;
      }
      case "dd":
        if (args.some((a) => a.startsWith("of=/dev/") && !NOT_A_FILE.test(a.slice(3)))) add("block", "disk", "dd writes to a device");
        else for (const a of args.filter((x) => x.startsWith("of="))) checkWrite(a.slice(3), "dd into");
        break;
      case "mkfs": case "mke2fs": case "mkswap": case "wipefs": case "fdisk": case "sfdisk": case "parted": case "gdisk": case "sgdisk": case "cryptsetup": case "diskutil": case "zpool":
        add("block", "disk", `${cmd} manages disks or partitions`);
        break;
      case "shutdown": case "reboot": case "halt": case "poweroff":
        add("block", "power", `${cmd} stops the machine`);
        break;
      case "kill":
        if (args[args.length - 1] === "-1") add("block", "power", "kill -1 signals every process you own");
        break;
      case "systemctl":
        if (has(args, "reboot", "poweroff", "halt", "kexec")) add("block", "power", `systemctl ${args.join(" ")}`);
        else if (has(args, "stop", "disable", "mask", "kill") && !has(args, "--user")) add("ask", "service", `systemctl ${args.join(" ")}`);
        else if (has(args, "enable", "link")) add("ask", "persistence", `systemctl ${args.join(" ")} starts code at boot or login`);
        break;
      case "crontab": if (!has(args, "-l")) add("ask", "persistence", "crontab installs scheduled jobs"); break;
      case "launchctl": if (has(args, "load", "bootstrap", "enable")) add("ask", "persistence", `launchctl ${args[0]}`); break;
      case "chmod": case "chown":
        if (hasShortFlag(args, "R") || has(args, "--recursive")) {
          for (const target of operands(args).slice(1)) {
            const path = resolvePath(target, place);
            if (path && isCatastrophicTarget(path, place) && !within(path, place.root)) add("block", "chmod-catastrophic", `${cmd} -R on ${path}`);
          }
        }
        break;
      case "git":
        // `git -c alias.x='!cmd' x` runs cmd through a shell.
        args.forEach((a, i) => {
          const alias = args[i - 1] === "-c" ? /^alias\.[^=]+=!([\s\S]*)$/.exec(a) : null;
          const inner = alias && depth < 3 ? checkBash(alias[1], place, depth + 1) : undefined;
          if (inner) { verdicts.push(inner); at.push(-1); }
        });
        checkGit(args, add);
        break;
      case "parallel": {
        // `parallel CMD ::: a b` runs CMD once per argument (with {} replaced, or the argument appended).
        const sep = args.findIndex((a) => a === ":::" || a === ":::+");
        if (sep < 0 || depth >= 3) break;
        let first = 0;
        while (first < sep && args[first].startsWith("-")) first += /^(-j|--jobs|-S|--sshlogin|-a|--arg-file|--delay|--timeout)$/.test(args[first]) ? 2 : 1;
        const template = args.slice(first, sep);
        for (const value of args.slice(sep + 1).filter((a) => !a.startsWith(":::"))) {
          const quoted = `'${value.replace(/'/g, "'\\''")}'`;
          const line = template.some((w) => w.includes("{}")) ? template.map((w) => w.replaceAll("{}", quoted)).join(" ") : `${template.join(" ")} ${quoted}`;
          const inner = checkBash(line, place, depth + 1);
          if (inner) { verdicts.push(inner); at.push(-1); }
        }
        break;
      }
      case "docker": case "podman":
        checkContainer(cmd, args, place, add);
        break;
      case "gh":
        checkGh(args, add);
        break;
      default:
        checkTool(cmd, args, add);
    }

    // Credential files named anywhere in the command (cat ~/.ssh/id_rsa, curl -d @.env, --file=…).
    if (!["rm", "shred", "unlink"].includes(cmd)) {
      for (const raw of args) {
        if (/^-[^-=]*$/.test(raw)) continue;
        const word = raw.replace(/^--?[\w-]+=/, "").replace(/^[\w-]+=@?/, "").replace(/^@/, "");
        if (!/[./]/.test(word)) continue;
        const path = resolvePath(word, place);
        if (path && isSecretPath(path)) { add("ask", "secret", `touches a credential file: ${path}`); break; }
        if (path && isSecretDir(path, place) && ["grep", "rg", "ag", "base64", "curl", "xxd", "strings"].includes(cmd)) { add("ask", "secret", `reads a credential directory: ${path}`); break; }
      }
    }
  });

  const kept = skip ? verdicts.filter((v, i) => at[i] < 0 || !skip(v, at[i])) : verdicts;
  return kept.find((v) => v.level === "block") ?? kept.find((v) => NEVER_PREAPPROVE.has(v.rule)) ?? kept[0];
}

/** Checks on the whole line: remote code run through a shell, metadata addresses, busy-waits. */
function checkLine(command: string, segments: Segment[], start: Place, add: Add) {
  const cmdOf = (s: Segment) => basename(commandWords(s.words).argv[0] ?? "");
  // Remote code run through substitution: bash <(curl …), eval "$(curl …)", sh -c "$(wget …)".
  const fetchSub = /(\$\(|`|<\()\s*(curl|wget)\b/.test(command) || segments.some((s) => s.substituted && ["curl", "wget"].includes(cmdOf(s)));
  if (fetchSub && segments.some((s) => !s.substituted && RUNS_TEXT.has(cmdOf(s)))) {
    add("block", "pipe-to-shell", "runs downloaded content; download, read, then run it");
  }

  // A file downloaded earlier in the same line, then run: curl -o i.sh … && bash i.sh.
  const downloaded = new Set<string>();
  segments.forEach((s) => {
    const { argv } = commandWords(s.words);
    const tool = basename(argv[0] ?? "");
    if (tool !== "curl" && tool !== "wget") return;
    const args = argv.slice(1);
    const url = args.find((a) => /^https?:\/\//.test(a)) ?? "";
    const named = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const out = tool === "curl" ? named("-o") ?? named("--output") ?? (args.some((a) => /^-[a-zA-Z]*O$|^--remote-name$/.test(a)) ? basename(url.split("?")[0]) : undefined)
      : named("-O") ?? args.find((a) => a.startsWith("--output-document="))?.slice(18) ?? basename(url.split("?")[0]);
    for (const file of [out, ...redirections(args).writes]) { const p = file && file !== "-" ? resolvePath(file, start) : undefined; if (p) downloaded.add(p); }
  });
  if (downloaded.size) {
    for (const s of segments) {
      const { argv } = commandWords(s.words);
      const tool = basename(argv[0] ?? "");
      const target = RUNS_TEXT.has(tool) ? argv.slice(1).find((a) => !a.startsWith("-")) : argv[0];
      const p = target ? resolvePath(target, start) : undefined;
      if (p && downloaded.has(p)) add("block", "pipe-to-shell", "runs a file downloaded in the same command; download, read, then run it");
    }
  }

  // Cloud metadata endpoints hand out the machine's credentials.
  if (/169\.254\.169\.254|169\.254\.170\.2|metadata\.google\.internal|100\.100\.100\.200|fd00:ec2::254/i.test(command)) {
    add("ask", "secret", "requests a cloud metadata address, which serves instance credentials");
  }

  // Sleepless busy-wait: a loop body of only `:`/`true` spins a CPU and can run forever.
  segments.forEach((s, i) => {
    if (s.words[0] !== "do") return;
    const body = [s.words.slice(1)];
    let j = i + 1;
    for (; j < segments.length && segments[j].words[0] !== "done"; j++) body.push(segments[j].words);
    if (j < segments.length && body.every((w) => w.every((x) => x === ":" || x === "true"))) {
      add("block", "busy-wait", "sleepless busy-wait loop (do :; done); put a sleep in the loop body, e.g. do sleep 5; done");
    }
  });

}

/** Commands judged by their name and arguments alone: infrastructure, databases, packages, agents. */
function checkTool(cmd: string, args: string[], add: Add) {
  switch (cmd) {
    case "kubectl":
      if (has(args, "delete", "drain") && (args[0] === "delete" || args[0] === "drain")) add("ask", "infra-destroy", `kubectl ${args[0]}`);
      break;
    case "terraform": case "tofu": case "pulumi":
      if (args.includes("destroy") || (args.includes("apply") && (args.includes("-auto-approve") || args.includes("-destroy"))) || args.slice(0, 2).join(" ") === "state rm") add("ask", "infra-destroy", `${cmd} ${args.join(" ")}`);
      break;
    case "aws":
      if (args.some((a) => /^(delete|terminate|remove|deregister|purge)-/.test(a)) || args.slice(0, 2).join(" ") === "s3 rb" || (args.slice(0, 2).join(" ") === "s3 rm" && has(args, "--recursive"))) add("ask", "infra-destroy", `aws ${args.slice(0, 2).join(" ")}`);
      break;
    case "gcloud": case "az": case "helm": case "fly": case "flyctl": case "vercel": case "heroku":
      if (args.some((a) => /^(delete|destroy|uninstall|rm|remove)$/.test(a) || /:destroy$/.test(a))) add("ask", "infra-destroy", `${cmd} ${args.slice(0, 3).join(" ")}`);
      break;
    case "dropdb": case "dropuser": add("ask", "db-destroy", cmd); break;
    case "redis-cli": if (args.some((a) => /^flush(all|db)$/i.test(a))) add("ask", "db-destroy", "redis-cli flush"); break;
    case "psql": case "mysql": case "mariadb": case "mongosh": case "mongo":
      if (args.some((a) => /\b(drop\s+(database|schema|table)|truncate\b|dropDatabase)/i.test(a))) add("ask", "db-destroy", `${cmd} drops or truncates data`);
      break;
    case "npm": case "pnpm": case "yarn": case "bun": case "cargo": case "twine": case "gem": case "uv": case "poetry": case "hatch": case "vsce": case "ovsx": case "deno":
      if (["publish", "unpublish", "deprecate", "yank", "push"].includes(args[0]) || (args[0] === "dist-tag" && args[1] !== "ls") || (cmd === "twine" && args[0] === "upload")) add("ask", "publish", `${cmd} ${args[0]} publishes a package`);
      else if (["npm", "pnpm", "yarn", "bun"].includes(cmd) && has(args, "-g", "--global") && ["i", "install", "add", "uninstall", "remove", "link"].includes(args[0] ?? "")) add("ask", "global-install", `${cmd} ${args.join(" ")} changes the machine`);
      break;
    case "pip": case "pip3":
      if (args[0] === "install" && has(args, "--user", "--break-system-packages")) add("ask", "global-install", `pip ${args.join(" ")} changes the machine`);
      break;
    case "pi":
      if (has(args, "-ne", "--no-extensions")) add("ask", "guard-bypass", "starts pi without extensions (no guard)");
      break;
    case "pitcrew":
      if (args[0] === "tidy" && has(args, "--force")) add("ask", "git-discard", "pitcrew tidy --force removes branches and worktrees that are not merged");
      break;
    case "claude":
      if (has(args, "--dangerously-skip-permissions") || args.join(" ").includes("--permission-mode bypassPermissions")) add("ask", "guard-bypass", "starts Claude Code with permissions bypassed");
      break;
    case "codex": case "gemini":
      if (has(args, "--dangerously-bypass-approvals-and-sandbox", "--yolo", "-y") || args.join(" ").includes("danger-full-access")) add("ask", "guard-bypass", `starts ${cmd} without approvals or sandbox`);
      break;
    case "export":
      if (args.some((a) => a.startsWith("PI_GUARD"))) add("ask", "guard-bypass", "sets PI_GUARD_* for child processes");
      break;
    case "unset":
      if (args.some((a) => a.startsWith("PI_GUARD"))) add("ask", "guard-bypass", "unsets PI_GUARD_*");
      break;
  }
}

function checkGit(args: string[], add: Add) {
  // Skip global options such as -C <dir> and -c key=value.
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    // A per-command hooks path or fsmonitor swaps the repo's hooks for any code.
    const kv = args[i] === "-c" ? args[i + 1] ?? "" : args[i].startsWith("--config-env") ? args[i] : "";
    if (/^core\.(hookspath|fsmonitor)\b/i.test(kv) || /^--config-env=core\.(hookspath|fsmonitor)/i.test(kv)) add("ask", "guard-bypass", `git -c ${kv} replaces the repo hooks`);
    i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  switch (sub) {
    case "push":
      if (has(rest, "--force", "-f", "--mirror") || rest.some((a) => /^\+/.test(a)) || hasShortFlag(rest, "f")) {
        add("block", "git-force-push", "force push rewrites remote history; use --force-with-lease if you must");
      } else if (has(rest, "--delete", "-d") || rest.some((a) => a.startsWith(":"))) add("ask", "git-push", "deletes a remote branch");
      else add("ask", "git-push", `git push ${rest.join(" ")}`.trim());
      break;
    case "reset":
      if (has(rest, "--hard", "--merge", "--keep")) add("ask", "git-discard", "git reset --hard discards uncommitted work");
      break;
    case "clean":
      if (hasShortFlag(rest, "f") || has(rest, "--force")) add("ask", "git-discard", "git clean deletes untracked files");
      break;
    case "restore":
      if ((rest.includes(".") || rest.length) && !(has(rest, "--staged", "-S") && !has(rest, "--worktree", "-W"))) add("ask", "git-discard", "git restore overwrites working-tree changes");
      break;
    case "checkout":
      if (rest.includes(".") || rest.includes("--") || has(rest, "-f", "--force")) add("ask", "git-discard", "git checkout overwrites working-tree changes");
      break;
    case "switch":
      if (has(rest, "-f", "--force", "--discard-changes")) add("ask", "git-discard", "git switch discards working-tree changes");
      break;
    case "stash":
      if (has(rest, "drop", "clear")) add("ask", "git-discard", `git stash ${rest[0]} deletes stashed work`);
      break;
    case "branch":
      if (has(rest, "-D") || (has(rest, "-d", "--delete") && has(rest, "--force", "-f"))) add("ask", "git-discard", "force-deletes a branch");
      break;
    case "worktree":
      if (rest[0] === "remove" && has(rest, "-f", "--force")) add("ask", "git-discard", "force-removes a worktree with changes");
      break;
    case "update-ref":
      if (has(rest, "-d")) add("ask", "git-history", "deletes a ref");
      break;
    case "reflog":
      if (rest[0] === "expire" || rest[0] === "delete") add("ask", "git-history", "removes recovery history");
      break;
    case "gc":
      if (rest.some((a) => a.startsWith("--prune"))) add("ask", "git-history", "prunes unreachable objects");
      break;
    case "filter-branch": case "filter-repo":
      add("ask", "git-history", `git ${sub} rewrites history`);
      break;
    case "config":
      if (has(rest, "--global", "--system") && !/^(user|init|color|alias|pull|push\.default)\b/.test(operands(rest)[0] ?? "user") && !has(rest, "--get", "--list", "-l", "--get-all")) {
        add("ask", "write-outside", `git config ${rest.join(" ")} changes global git behaviour`);
      }
      break;
  }
}

function checkGh(args: string[], add: Add) {
  const two = args.slice(0, 2).join(" ");
  if (/^(repo (delete|archive|rename|edit|transfer)|release (create|delete|edit|upload)|pr (merge|close)|issue (delete|transfer)|workflow run|(secret|variable) (set|delete))$/.test(two)) {
    add("ask", "github-write", `gh ${two}`);
  } else if (/^(issue|pr) (create|comment|edit)$/.test(two)) {
    add("ask", "publish", `gh ${two} writes to GitHub`);
  } else if (args[0] === "api") {
    const mi = args.findIndex((a) => a === "-X" || a === "--method");
    const method = mi >= 0 ? (args[mi + 1] ?? "").toUpperCase() : args.some((a) => /^(-f|-F|--field|--raw-field|--input)$/.test(a)) ? "POST" : "GET";
    // A GraphQL query is sent as a POST but only reads; a mutation (or a query from a file) asks.
    const graphqlRead = args.includes("graphql") && args.some((a) => /^query=[^@]/.test(a)) && !args.some((a) => /\bmutation\b/.test(a));
    if (method !== "GET" && !graphqlRead) add("ask", "github-write", `gh api ${method}`);
  }
}

function checkContainer(cmd: string, args: string[], place: Place, add: Add) {
  const two = args.slice(0, 2).join(" ");
  if (/^(system|volume|image|container|builder|network) prune$/.test(two) || two === "volume rm" || (two === "compose down" && has(args, "-v", "--volumes"))) {
    add("ask", "docker-destroy", `${cmd} ${two} deletes data`);
  }
  if (args[0] === "push") add("ask", "publish", `${cmd} push publishes an image`);
  if (args[0] === "run" || args[0] === "create" || two === "compose run") {
    // Docker access is root access: flag runs that reach the host.
    if (args.some((a) => a === "--privileged" || /^--(pid|ipc|userns|uts)=host$/.test(a) || /^--cap-add=?(SYS_ADMIN|ALL)?$/.test(a) || a.startsWith("--device"))) {
      add("ask", "docker-host", `${cmd} run with host privileges`);
    }
    args.forEach((a, i) => {
      const spec = a === "-v" || a === "--volume" || a === "--mount" ? args[i + 1] ?? "" : /^(-v|--volume=|--mount=)/.test(a) ? a.replace(/^(-v|--volume=|--mount=)/, "") : "";
      if (!spec) return;
      const src = spec.includes("source=") || spec.includes("src=") ? (/(?:source|src)=([^,]+)/.exec(spec)?.[1] ?? "") : spec.split(":")[0];
      const path = src.startsWith("/") || src.startsWith("~") || src.startsWith(".") || src.startsWith("$") ? resolvePath(src, place) : undefined;
      if (src.startsWith("/") || src.startsWith("~") || src.startsWith(".") || src.startsWith("$")) {
        if (!path || path.endsWith("docker.sock") || !isScratchOrProject(path, place)) add("ask", "docker-host", `${cmd} mounts a host path outside the project: ${src}`);
      }
    });
  }
}

// ---------------------------------------------------------------- file tool rules

export function checkFileTool(tool: "read" | "write" | "edit" | "grep" | "find" | "ls", rawPath: string, place: Place): Verdict | undefined {
  const path = resolvePath(rawPath, place) ?? rawPath;
  const real = realOf(path, place);
  if (isSecretPath(path) || isSecretPath(real)) return { level: "ask", rule: "secret", reason: `${tool} of a credential file: ${path}` };
  if ((tool === "grep" || tool === "find") && isSecretDir(path, place) && path !== place.home) return { level: "ask", rule: "secret", reason: `${tool} in a credential directory: ${path}` };
  if (tool !== "write" && tool !== "edit") return undefined;
  if (inGitDir(path)) return { level: "ask", rule: "git-internals", reason: `${tool} inside .git: ${path}` };
  if (!isScratchOrProject(path, place)) return { level: "ask", rule: "write-outside", reason: `${tool} outside the project (${place.root}): ${path}` };
  return undefined;
}

// ---------------------------------------------------------------- runner workers

const WORKER_GIT_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

// Names of variables that hold credentials (CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN, AWS_SECRET_ACCESS_KEY, …).
export const SECRET_VAR = /TOKEN|SECRET|PASSW(OR)?D|API_?KEY|_KEY$|CREDENTIAL|^AUTH/i;
const ENV_DUMP = new Set(["printenv", "env", "export", "declare", "typeset", "set", "compgen"]);

/** Does this simple command print a credential into the output (and so the model context)? */
export function printsSecret(words: string[]): string | undefined {
  for (const w of words) {
    for (const m of w.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) if (SECRET_VAR.test(m[1])) return `expands $${m[1]}`;
    if (/^\/proc\/[^/]+\/environ$/.test(w)) return `reads ${w}`;
  }
  const { argv } = commandWords(words);
  const first = basename(words.find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? "");
  if (first === "env" && !argv.length) return "env prints every variable, tokens included";
  const cmd = basename(argv[0] ?? "");
  const args = argv.slice(1);
  if (cmd === "gh" && args[0] === "auth" && (args[1] === "token" || (args[1] === "status" && has(args, "-t", "--show-token")))) return `gh auth ${args[1]} prints the GitHub token`;
  if (ENV_DUMP.has(cmd)) {
    if (cmd === "printenv") return args.length && !args.some((a) => SECRET_VAR.test(a)) ? undefined : "printenv prints tokens";
    if ((cmd === "export" || cmd === "declare" || cmd === "typeset") && (!args.length || args.every((a) => /^-[a-zA-Z]+$/.test(a)) && args.some((a) => /[px]/.test(a)))) return `${cmd} ${args.join(" ")} prints every exported variable`;
    if (cmd === "set" && !args.length) return "set prints every variable";
    if (cmd === "compgen" && has(args, "-e", "-v")) return "compgen lists variables";
  }
  return undefined;
}

/** `pitcrew run` or `pitcrew box` anywhere in the words (also behind nohup, node …). */
export function startsAutomation(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const b = basename(argv[i]).replace(/\.m?js$/, "");
    if (b === "pitcrew" && (argv[i + 1] === "run" || argv[i + 1] === "box")) return `pitcrew ${argv[i + 1]}`;
  }
  return undefined;
}

/** Extra blocks for the workers of `pitcrew run` (`PITCREW_RUNNER_ROLE=worker`): only the runner merges,
 *  deletes, releases, pushes the base branch or starts more runs; no worker prints a token.
 *  They hold even when PI_GUARD_ALLOW lists git-push or publish. */
export function checkWorker(command: string, base = "main", depth = 0): Verdict | undefined {
  const block = (reason: string): Verdict => ({ level: "block", rule: "worker", reason: `${reason}; a runner worker leaves this to pitcrew run` });
  for (const s of splitCommands(command)) {
    const argv = commandWords(s.words).argv;
    const cmd = basename(argv[0] ?? "");
    const args = argv.slice(1);
    // Unattended workers never see credentials and never start more unattended work.
    const secret = printsSecret(s.words);
    if (secret) return { level: "block", rule: "worker", reason: `${secret}; a runner worker never prints credentials` };
    const nested = startsAutomation(argv);
    if (nested) return block(`nested ${nested}`);
    if (depth < 3 && (SHELLS.has(cmd) || cmd === "eval")) {
      const f = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
      const script = cmd === "eval" ? args.join(" ") : f >= 0 ? args[f + 1] : s.heredoc;
      const inner = script ? checkWorker(script, base, depth + 1) : undefined;
      if (inner) return inner;
    }
    if (cmd === "git") {
      let i = 0;
      while (i < args.length && args[i].startsWith("-")) i += WORKER_GIT_OPTS.has(args[i]) ? 2 : 1;
      if (args[i] !== "push") continue;
      const rest = args.slice(i + 1);
      if (rest.some((a) => a === "--all" || a === "--mirror")) return block("git push --all/--mirror");
      if (rest.some((a) => a === "--delete" || a === "-d")) return block("git push --delete");
      const refs = rest.filter((a) => !a.startsWith("-")).slice(1);
      if (refs.some((r) => r.replace(/^\+/, "").split(":").pop()!.replace(/^refs\/heads\//, "") === base)) return block(`push to the base branch ${base}`);
    }
    if (cmd === "gh") {
      const two = args.slice(0, 2).join(" ");
      if (args.includes("--admin")) return block("gh --admin");
      if (/^(pr (merge|close)|issue (close|delete|transfer)|release \S+|repo (delete|archive|edit|rename|transfer)|project delete|workflow run|(secret|variable) (set|delete))$/.test(two)) return block(`gh ${two}`);
      if (args[0] === "api") {
        const mi = args.findIndex((a) => a === "-X" || a === "--method" || /^--method=/.test(a));
        const method = (mi < 0 ? "" : args[mi].includes("=") ? args[mi].split("=")[1] : args[mi + 1] ?? "").toUpperCase();
        if (method === "DELETE") return block("gh api -X DELETE");
        if (args.some((a) => /\/merge$/.test(a)) && method === "PUT") return block("merge through the API");
      }
    }
  }
  return undefined;
}
