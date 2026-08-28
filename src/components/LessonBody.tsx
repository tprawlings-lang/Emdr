import { Fragment, type ReactNode } from "react";

// Minimal, safe renderer for our own code-defined lesson markdown. Handles the
// subset we author: `## headings`, blank-line paragraphs, `- bullets`, and
// **bold** / *italic* inline. Builds JSX (never dangerouslySetInnerHTML).

type Block = { type: "h2"; text: string } | { type: "p"; text: string } | { type: "ul"; items: string[] };

function parse(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === "") {
      i += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3) });
      i += 1;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().slice(2));
        i += 1;
      }
      blocks.push({ type: "ul", items });
    } else {
      const para: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (l === "" || l.startsWith("## ") || l.startsWith("- ")) break;
        para.push(l);
        i += 1;
      }
      blocks.push({ type: "p", text: para.join(" ") });
    }
  }
  return blocks;
}

// Inline **bold** / *italic*.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}

export default function LessonBody({ markdown }: { markdown: string }) {
  const blocks = parse(markdown);
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => {
        if (b.type === "h2")
          return (
            <h2 key={i} className="type-display text-xl font-medium text-ground">
              {inline(b.text)}
            </h2>
          );
        if (b.type === "ul")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-ground/90">
              {b.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="leading-relaxed text-ground/90">
            {inline(b.text)}
          </p>
        );
      })}
    </div>
  );
}
