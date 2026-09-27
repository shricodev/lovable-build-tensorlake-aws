/**
 * Keep the head and tail of long command output: errors usually show up at
 * the end (build failures) or the start (bad invocation), rarely the middle.
 */
export function truncateOutput(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = Math.floor(max * 0.3);
  const tail = max - head;
  const dropped = text.length - head - tail;
  return {
    text: `${text.slice(0, head)}\n… [${dropped} characters truncated] …\n${text.slice(-tail)}`,
    truncated: true,
  };
}
