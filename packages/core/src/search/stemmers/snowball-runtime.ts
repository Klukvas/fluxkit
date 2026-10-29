/**
 * Runtime of the Snowball stemmers in this folder (BSD-3-Clause, see `snowball/COPYING`).
 *
 * The generated modules (`snowball/ukrainian.generated.ts`, `snowball/english.generated.ts`) are closures built from the
 * Snowball algorithm files with `scripts/snowball/generate.mjs`; this file is what they run on. The semantics follow the
 * reference runtime `javascript/base-stemmer.js` of Snowball 3.2.0: cursor `c`, limits `l` and `lb`, the slice
 * `bra`..`ket`, forward and backward mode, `among` tables that pick the longest matching entry.
 *
 * One machine is shared by all algorithms. That is safe because a stem call is synchronous and does not nest, and it is
 * the reason this module is not exported from the package: callers use `stemToken`.
 */
export type Cmd = () => boolean;

interface Entry {
  readonly text: string;
  readonly cmd: Cmd | null;
  readonly table: AmongTable;
}

interface AmongTable {
  entries: readonly Entry[];
  empty: Entry | null;
  forward?: Map<string, readonly Entry[]>;
  backward?: Map<string, readonly Entry[]>;
}

interface Machine {
  s: string;
  c: number;
  l: number;
  lb: number;
  bra: number;
  ket: number;
  back: boolean;
  entry: Entry | null;
}

export const m: Machine = { s: "", c: 0, l: 0, lb: 0, bra: 0, ket: 0, back: false, entry: null };
const I = new Map<string, number>();
const F = new Map<string, boolean>();

// In backward mode the cursor is remembered as its distance from the end, so a replacement at the end keeps it valid.
const save = (): number => (m.back ? m.l - m.c : m.c);
const restore = (v: number): void => {
  m.c = m.back ? m.l - v : v;
};

export const seq =
  (...cmds: Cmd[]): Cmd =>
  () => {
    for (const cmd of cmds) {
      if (!cmd()) {
        return false;
      }
    }
    return true;
  };

export const or =
  (...cmds: Cmd[]): Cmd =>
  () => {
    const v = save();
    for (const cmd of cmds) {
      if (cmd()) {
        return true;
      }
      restore(v);
    }
    return false;
  };

export const not =
  (cmd: Cmd): Cmd =>
  () => {
    const v = save();
    const ok = cmd();
    restore(v);
    return !ok;
  };

export const attempt =
  (cmd: Cmd): Cmd =>
  () => {
    const v = save();
    if (!cmd()) {
      restore(v);
    }
    return true;
  };

export const doDo =
  (cmd: Cmd): Cmd =>
  () => {
    const v = save();
    cmd();
    restore(v);
    return true;
  };

export const test =
  (cmd: Cmd): Cmd =>
  () => {
    const v = save();
    const ok = cmd();
    restore(v);
    return ok;
  };

export const backwards =
  (cmd: Cmd): Cmd =>
  () => {
    const savedLb = m.lb;
    const savedBack = m.back;
    m.lb = m.c;
    m.c = m.l;
    m.back = true;
    const ok = cmd();
    m.back = savedBack;
    m.c = m.lb;
    m.lb = savedLb;
    return ok;
  };

export const setLimitToMark =
  (mark: () => number, cmd: Cmd): Cmd =>
  () => {
    if (!m.back) {
      throw new Error("setlimit is only translated for backward mode");
    }
    const limit = mark();
    if (m.c < limit) {
      return false;
    }
    const savedLb = m.lb;
    m.lb = limit;
    const ok = cmd();
    m.lb = savedLb;
    return ok;
  };

export const bra: Cmd = () => {
  if (m.back) {
    m.ket = m.c;
  } else {
    m.bra = m.c;
  }
  return true;
};

export const ket: Cmd = () => {
  if (m.back) {
    m.bra = m.c;
  } else {
    m.ket = m.c;
  }
  return true;
};

export const makeAmong = (
  groups: ReadonlyArray<readonly [readonly string[], Cmd | null]>,
): AmongTable => {
  const table: AmongTable = { entries: [], empty: null };
  const entries: Entry[] = [];
  for (const [texts, cmd] of groups) {
    for (const text of texts) {
      entries.push({ text, cmd, table });
    }
  }
  table.entries = entries;
  table.empty = entries.find((entry) => entry.text === "") ?? null;
  return table;
};

const index = (table: AmongTable, back: boolean): Map<string, readonly Entry[]> => {
  const cached = back ? table.backward : table.forward;
  if (cached) {
    return cached;
  }
  const map = new Map<string, Entry[]>();
  for (const entry of table.entries) {
    if (entry.text === "") {
      continue;
    }
    const key = back ? entry.text.charAt(entry.text.length - 1) : entry.text.charAt(0);
    const list = map.get(key);
    if (list) {
      list.push(entry);
    } else {
      map.set(key, [entry]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.text.length - a.text.length);
  }
  if (back) {
    table.backward = map;
  } else {
    table.forward = map;
  }
  return map;
};

// The longest entry that matches at the cursor (a prefix going forward, a suffix going backward); the empty string last.
const find = (table: AmongTable): Entry | null => {
  if (m.back) {
    if (m.c <= m.lb) {
      return table.empty;
    }
    const list = index(table, true).get(m.s.charAt(m.c - 1));
    for (const entry of list ?? []) {
      const start = m.c - entry.text.length;
      if (start >= m.lb && m.s.startsWith(entry.text, start)) {
        return entry;
      }
    }
    return table.empty;
  }
  if (m.c >= m.l) {
    return table.empty;
  }
  const list = index(table, false).get(m.s.charAt(m.c));
  for (const entry of list ?? []) {
    if (m.c + entry.text.length <= m.l && m.s.startsWith(entry.text, m.c)) {
      return entry;
    }
  }
  return table.empty;
};

const advance = (entry: Entry): void => {
  m.c += m.back ? -entry.text.length : entry.text.length;
};

export const substring =
  (table: AmongTable): Cmd =>
  () => {
    const entry = find(table);
    if (!entry) {
      return false;
    }
    advance(entry);
    m.entry = entry;
    return true;
  };

/** `among` after a `substring`: runs the command of the entry that `substring` found. */
export const amongCommand =
  (table: AmongTable): Cmd =>
  () => {
    const entry = m.entry;
    if (!entry || entry.table !== table) {
      throw new Error("among without its substring");
    }
    return entry.cmd ? entry.cmd() : true;
  };

/** A stand-alone `among`: match, then run the command of the entry. */
export const among =
  (table: AmongTable): Cmd =>
  () => {
    const entry = find(table);
    if (!entry) {
      return false;
    }
    advance(entry);
    return entry.cmd ? entry.cmd() : true;
  };

const replace = (from: number, to: number, text: string): void => {
  const adjustment = text.length - (to - from);
  m.s = m.s.slice(0, from) + text + m.s.slice(to);
  m.l += adjustment;
  if (m.c >= to) {
    m.c += adjustment;
  } else if (m.c > from) {
    m.c = from;
  }
};

export const sliceFrom =
  (text: string): Cmd =>
  () => {
    replace(m.bra, m.ket, text);
    m.ket = m.bra + text.length;
    return true;
  };

export const sliceDelete: Cmd = sliceFrom("");

export const setFlag =
  (name: string, value: boolean): Cmd =>
  () => {
    F.set(name, value);
    return true;
  };

export const flag =
  (name: string): Cmd =>
  () =>
    F.get(name) === true;

export const never: Cmd = () => false;
export const always: Cmd = () => true;

export const next: Cmd = () => {
  if (m.back) {
    if (m.c <= m.lb) {
      return false;
    }
    m.c--;
  } else {
    if (m.c >= m.l) {
      return false;
    }
    m.c++;
  }
  return true;
};

export const repeat =
  (cmd: Cmd): Cmd =>
  () => {
    for (;;) {
      const v = save();
      if (!cmd()) {
        restore(v);
        return true;
      }
    }
  };

/** `goto C`: step over characters until C succeeds, leaving the cursor where C started. */
export const goTo =
  (cmd: Cmd): Cmd =>
  () => {
    for (;;) {
      const v = save();
      if (cmd()) {
        restore(v);
        return true;
      }
      restore(v);
      if (!next()) {
        return false;
      }
    }
  };

export const atLimit: Cmd = () => (m.back ? m.c <= m.lb : m.c >= m.l);

export const hop =
  (n: number): Cmd =>
  () => {
    if (m.back) {
      if (m.c - n < m.lb) {
        return false;
      }
      m.c -= n;
    } else {
      if (m.c + n > m.l) {
        return false;
      }
      m.c += n;
    }
    return true;
  };

export const lit =
  (text: string): Cmd =>
  () => {
    if (m.back) {
      const start = m.c - text.length;
      if (start < m.lb || !m.s.startsWith(text, start)) {
        return false;
      }
      m.c = start;
    } else {
      if (m.l - m.c < text.length || !m.s.startsWith(text, m.c)) {
        return false;
      }
      m.c += text.length;
    }
    return true;
  };

export const inGrouping =
  (set: ReadonlySet<string>): Cmd =>
  () => {
    if (m.back) {
      if (m.c <= m.lb || !set.has(m.s.charAt(m.c - 1))) {
        return false;
      }
      m.c--;
    } else {
      if (m.c >= m.l || !set.has(m.s.charAt(m.c))) {
        return false;
      }
      m.c++;
    }
    return true;
  };

export const outGrouping =
  (set: ReadonlySet<string>): Cmd =>
  () => {
    if (m.back) {
      if (m.c <= m.lb || set.has(m.s.charAt(m.c - 1))) {
        return false;
      }
      m.c--;
    } else {
      if (m.c >= m.l || set.has(m.s.charAt(m.c))) {
        return false;
      }
      m.c++;
    }
    return true;
  };

// `gopast G` and `gopast non-G`: step over characters up to and including the first one that is (or is not) in the grouping.
const goPast =
  (set: ReadonlySet<string>, wanted: boolean): Cmd =>
  () => {
    if (m.back) {
      while (m.c > m.lb) {
        const hit = set.has(m.s.charAt(m.c - 1)) === wanted;
        m.c--;
        if (hit) {
          return true;
        }
      }
      return false;
    }
    while (m.c < m.l) {
      const hit = set.has(m.s.charAt(m.c)) === wanted;
      m.c++;
      if (hit) {
        return true;
      }
    }
    return false;
  };

export const goPastIn = (set: ReadonlySet<string>): Cmd => goPast(set, true);
export const goPastOut = (set: ReadonlySet<string>): Cmd => goPast(set, false);

export const int = (name: string): number => I.get(name) ?? 0;

export const setInt =
  (name: string, value: () => number): Cmd =>
  () => {
    I.set(name, value());
    return true;
  };

export const cmpInt =
  (a: () => number, op: "<" | "<=" | ">" | ">=" | "==" | "!=", b: () => number): Cmd =>
  () => {
    const x = a();
    const y = b();
    switch (op) {
      case "<":
        return x < y;
      case "<=":
        return x <= y;
      case ">":
        return x > y;
      case ">=":
        return x >= y;
      case "==":
        return x === y;
      case "!=":
        return x !== y;
    }
  };

/**
 * Runs the `stem` routine of an algorithm on one lower-case word and returns the string as it stands, also when the
 * routine reports failure: that is how the reference stemmers behave (a failed routine may already have changed the word).
 */
export const runStem = (word: string, stem: Cmd): string => {
  m.s = word;
  m.c = 0;
  m.l = word.length;
  m.lb = 0;
  m.bra = 0;
  m.ket = 0;
  m.back = false;
  m.entry = null;
  F.clear();
  I.clear();
  stem();
  return m.s;
};
