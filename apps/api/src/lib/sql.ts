/** A LIKE pattern that matches `term` literally anywhere, with % and _ escaped. */
export function containsPattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
