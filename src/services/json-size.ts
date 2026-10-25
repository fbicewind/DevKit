import { StateField } from "@codemirror/state";
import type { Text, Transaction } from "@codemirror/state";

const encoder = new TextEncoder();
function byteLength(text: Text): number {
  let size = 0;
  for (const chunk of text.iter()) size += encoder.encode(chunk).length;
  return size;
}

// Only measure changed ranges. Include adjacent code units so edits that split
// or join a UTF-16 surrogate pair have the same byte count as TextEncoder.
export function updatedByteLength(
  previous: number,
  transaction: Transaction,
): number {
  if (!transaction.docChanged) return previous;
  const ranges: { fromA: number; toA: number; fromB: number; toB: number }[] =
    [];
  transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
    const range = {
      fromA: Math.max(0, fromA - 1),
      toA: Math.min(transaction.startState.doc.length, toA + 1),
      fromB: Math.max(0, fromB - 1),
      toB: Math.min(transaction.newDoc.length, toB + 1),
    };
    const last = ranges.at(-1);
    if (last && (range.fromA <= last.toA || range.fromB <= last.toB)) {
      last.toA = Math.max(last.toA, range.toA);
      last.toB = Math.max(last.toB, range.toB);
    } else ranges.push(range);
  });
  let bytes = previous;
  for (const range of ranges) {
    bytes -= encoder.encode(
      transaction.startState.doc.sliceString(range.fromA, range.toA),
    ).length;
    bytes += encoder.encode(
      transaction.newDoc.sliceString(range.fromB, range.toB),
    ).length;
  }
  return bytes;
}

export const jsonByteSize = StateField.define<number>({
  create: (state) => byteLength(state.doc),
  update: updatedByteLength,
});
