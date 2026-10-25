// UTF-16 offsets match CodeMirror positions. JSON contents and numeric literals
// are never decoded or rewritten; only structural delimiters are indexed.
const MAX_DEPTH = 128;
const MAX_CONTAINERS = 1_500_000;
export interface FoldIndexRequest {
  revision: number;
  source: string;
}
export interface FoldIndexReply {
  revision: number;
  ranges: Uint32Array;
}

export class JsonFoldScanner {
  private position = 0;
  private line = 0;
  private quoted = false;
  private escaped = false;
  private stack: { kind: number; line: number; slot: number }[] = [];
  private ranges: number[] = [];
  private complete = false;
  constructor(private readonly source: string) {}

  // Bounded steps also let the fallback yield when Workers are unavailable.
  step(budget = 65_536): boolean {
    if (this.complete) return true;
    const end = Math.min(this.source.length, this.position + budget);
    for (; this.position < end; this.position++) {
      const code = this.source.charCodeAt(this.position);
      if (code === 10) this.line++;
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (code === 92) this.escaped = true;
        else if (code === 34) this.quoted = false;
        continue;
      }
      if (code === 34) {
        this.quoted = true;
        continue;
      }
      if (code === 123 || code === 91) {
        if (
          this.stack.length > MAX_DEPTH ||
          this.ranges.length / 2 >= MAX_CONTAINERS
        ) {
          this.ranges = [];
          this.complete = true;
          return true;
        }
        this.stack.push({
          kind: code,
          line: this.line,
          slot: this.ranges.length,
        });
        this.ranges.push(this.position + 1, 0);
      } else if (code === 125 || code === 93) {
        const opening = this.stack.pop();
        if (!opening || opening.kind !== (code === 125 ? 123 : 91)) {
          this.ranges = [];
          this.complete = true;
          return true;
        }
        if (this.line > opening.line)
          this.ranges[opening.slot + 1] = this.position;
      }
    }
    this.complete = this.position === this.source.length;
    return this.complete;
  }

  finish(): Uint32Array {
    if (!this.complete) throw new Error("Fold scan is not complete");
    let count = 0;
    for (let i = 1; i < this.ranges.length; i += 2)
      if (this.ranges[i]) count += 2;
    const result = new Uint32Array(count);
    for (let i = 0, output = 0; i < this.ranges.length; i += 2) {
      if (this.ranges[i + 1]) {
        result[output++] = this.ranges[i];
        result[output++] = this.ranges[i + 1];
      }
    }
    return result;
  }
}

export function indexJsonFolds(source: string): Uint32Array {
  const scanner = new JsonFoldScanner(source);
  while (!scanner.step()) {
    /* Worker scans to completion without UI work. */
  }
  return scanner.finish();
}

export function findJsonFold(
  ranges: Uint32Array,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  let low = 0,
    high = ranges.length / 2;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle * 2] <= lineStart) low = middle + 1;
    else high = middle;
  }
  for (let i = low * 2; i < ranges.length && ranges[i] <= lineEnd; i += 2) {
    if (ranges[i + 1] > lineEnd) return { from: ranges[i], to: ranges[i + 1] };
  }
  return null;
}
