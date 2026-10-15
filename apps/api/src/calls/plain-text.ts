// Notes and the AI control's texts are shown and copied as plain text, so they must not carry
// Markdown. The model is told so, but sometimes answers with asterisks, # headings or a table
// anyway; this takes the markup away and keeps the words.
export function plainText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    // A table's separator row (|---|:---:|) goes.
    .filter((line) => !/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*(:?-{3,}:?)?\s*\|?\s*$/.test(line))
    .map((line) => {
      // A horizontal rule (---, ***, ___) or a heading's underline (===) becomes an empty line.
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*={3,}\s*$/.test(line)) return "";
      let l = line
        // "## Sammendrag" → "Sammendrag", "> sitat" → "sitat".
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s{0,3}>\s?/, "")
        // "* punkt", "+ punkt" and "• punkt" → "- punkt".
        .replace(/^(\s*)[*+•]\s+/, "$1- ");
      // A table row "| Pris | 299 kr |" → "Pris – 299 kr".
      if (/^\s*\|.*\|\s*$/.test(l)) {
        l = l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join(" – ");
      }
      return (
        l
          // Images keep their text, and links their text and address.
          .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_, label: string, url: string) => (url && url !== label ? `${label} (${url})` : label))
          // Bold and italics: **x**, __x__, *x*, _x_ (not snake_case or 2*3).
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/__(.+?)__/g, "$1")
          .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1$2")
          .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1$2")
          // Inline code.
          .replace(/`([^`]+)`/g, "$1")
          // What is left of a pair that did not match.
          .replace(/\*\*/g, "")
      );
    });
  // At most one empty line in a row, and none at the ends.
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
