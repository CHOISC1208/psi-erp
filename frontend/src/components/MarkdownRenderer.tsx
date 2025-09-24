import { Fragment, ReactNode } from "react";

interface MarkdownRendererProps {
  source: string;
}

type MarkdownBlock =
  | { type: "heading"; level: number; content: string }
  | { type: "paragraph"; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; content: string }
  | { type: "blockquote"; content: string };

const INLINE_TOKEN_PATTERN =
  /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|!\[[^\]]*\]\([^\s)]+\)|\[[^\]]+\]\([^\s)]+\)|\*[^*]+\*|_[^_]+_)/g;
const AUTO_LINK_PATTERN = /(https?:\/\/[^\s<]+)/g;

const parseMarkdown = (markdown: string): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = [];
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  let currentParagraph: string[] = [];
  let currentList: { ordered: boolean; items: string[] } | null = null;
  let currentCode: string[] | null = null;
  let currentQuote: string[] | null = null;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      blocks.push({ type: "paragraph", content: currentParagraph.join(" ") });
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (currentList) {
      blocks.push({ type: "list", ordered: currentList.ordered, items: currentList.items });
      currentList = null;
    }
  };

  const flushCode = () => {
    if (currentCode) {
      blocks.push({ type: "code", content: currentCode.join("\n") });
      currentCode = null;
    }
  };

  const flushQuote = () => {
    if (currentQuote) {
      blocks.push({ type: "blockquote", content: currentQuote.join("\n") });
      currentQuote = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");

    if (currentCode) {
      if (/^```/.test(line.trim())) {
        flushCode();
        continue;
      }
      currentCode.push(rawLine);
      continue;
    }

    if (/^```/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushQuote();
      currentCode = [];
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      flushCode();
      flushQuote();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushCode();
      flushQuote();
      blocks.push({ type: "heading", level: headingMatch[1].length, content: headingMatch[2].trim() });
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      if (!currentQuote) {
        currentQuote = [];
      }
      currentQuote.push(quoteMatch[1]);
      continue;
    }

    flushQuote();

    const listMatch = line.match(/^(\d+\.|[-*])\s+(.*)$/);
    if (listMatch) {
      const isOrdered = /\d+\./.test(listMatch[1]);
      if (!currentList || currentList.ordered !== isOrdered) {
        flushParagraph();
        flushList();
        currentList = { ordered: isOrdered, items: [] };
      }
      currentList.items.push(listMatch[2]);
      continue;
    }

    flushList();
    currentParagraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCode();
  flushQuote();

  return blocks;
};

const renderTextWithLinks = (text: string, keyPrefix: string): ReactNode[] => {
  const segments: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = AUTO_LINK_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    segments.push(
      <a key={`${keyPrefix}-link-${segments.length}`} href={url} target="_blank" rel="noreferrer">
        {url}
      </a>,
    );
    lastIndex = AUTO_LINK_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments;
};

const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
  const elements: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(...renderTextWithLinks(text.slice(lastIndex, match.index), `${keyPrefix}-text-${elements.length}`));
    }

    const token = match[0];

    if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      const inner = token.slice(2, -2);
      elements.push(
        <strong key={`${keyPrefix}-strong-${elements.length}`}>
          {renderInline(inner, `${keyPrefix}-strong`)}
        </strong>,
      );
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      const inner = token.slice(1, -1);
      elements.push(
        <em key={`${keyPrefix}-em-${elements.length}`}>{renderInline(inner, `${keyPrefix}-em`)}</em>,
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      const inner = token.slice(2, -2);
      elements.push(
        <del key={`${keyPrefix}-del-${elements.length}`}>{renderInline(inner, `${keyPrefix}-del`)}</del>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      const inner = token.slice(1, -1);
      elements.push(
        <code key={`${keyPrefix}-code-${elements.length}`}>{inner}</code>,
      );
    } else if (token.startsWith("![")) {
      const parts = token.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
      if (parts) {
        const [, alt, url] = parts;
        elements.push(<img key={`${keyPrefix}-img-${elements.length}`} src={url} alt={alt} />);
      } else {
        elements.push(token);
      }
    } else if (token.startsWith("[")) {
      const parts = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
      if (parts) {
        const [, label, url] = parts;
        elements.push(
          <a key={`${keyPrefix}-anchor-${elements.length}`} href={url} target="_blank" rel="noreferrer">
            {renderInline(label, `${keyPrefix}-anchor`)}
          </a>,
        );
      } else {
        elements.push(token);
      }
    } else {
      elements.push(token);
    }

    lastIndex = INLINE_TOKEN_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(...renderTextWithLinks(text.slice(lastIndex), `${keyPrefix}-text-${elements.length}`));
  }

  return elements;
};

const renderBlock = (block: MarkdownBlock, index: number): ReactNode => {
  const keyPrefix = `block-${index}`;

  switch (block.type) {
    case "heading": {
      const Tag = `h${Math.min(block.level, 6)}` as keyof JSX.IntrinsicElements;
      return <Tag key={keyPrefix}>{renderInline(block.content, `${keyPrefix}-heading`)}</Tag>;
    }
    case "paragraph":
      return <p key={keyPrefix}>{renderInline(block.content, `${keyPrefix}-paragraph`)}</p>;
    case "list":
      if (block.ordered) {
        return (
          <ol key={keyPrefix}>
            {block.items.map((item, itemIndex) => (
              <li key={`${keyPrefix}-item-${itemIndex}`}>{renderInline(item, `${keyPrefix}-item-${itemIndex}`)}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul key={keyPrefix}>
          {block.items.map((item, itemIndex) => (
            <li key={`${keyPrefix}-item-${itemIndex}`}>{renderInline(item, `${keyPrefix}-item-${itemIndex}`)}</li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre key={keyPrefix}>
          <code>{block.content}</code>
        </pre>
      );
    case "blockquote": {
      const quoteLines = block.content.split("\n");
      return (
        <blockquote key={keyPrefix}>
          {quoteLines.map((line, lineIndex) => (
            <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
              {renderInline(line, `${keyPrefix}-line-${lineIndex}`)}
              {lineIndex < quoteLines.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </blockquote>
      );
    }
    default:
      return null;
  }
};

const MarkdownRenderer = ({ source }: MarkdownRendererProps) => {
  const blocks = parseMarkdown(source);

  return <div className="psi-markdown">{blocks.map((block, index) => renderBlock(block, index))}</div>;
};

export default MarkdownRenderer;
