import { useEffect, useMemo, useState } from "react";

import "../styles/DocsPage.css";

type DocEntry = {
  id: string;
  fileName: string;
  title: string;
  content: string;
  searchableText: string;
};

const markdownModules = import.meta.glob("../../../*.md", {
  eager: true,
  query: "?raw",
  import: "default"
}) as Record<string, string>;

const extractTitle = (content: string, fileName: string): string => {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      return trimmed.replace(/^#+\s*/, "").trim() || fileName.replace(/\.md$/i, "");
    }
  }
  return fileName.replace(/\.md$/i, "");
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const formatInlineMarkdown = (value: string): string => {
  const escaped = escapeHtml(value);
  const withCode = escaped.replace(/`([^`]+)`/g, (_match, code) => `<code>${code}</code>`);
  const withLinks = withCode.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) =>
    `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  const withBold = withLinks
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>");
  const withItalics = withBold
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
  const withStrikethrough = withItalics.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return withStrikethrough;
};

const renderMarkdown = (markdown: string): string => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const htmlParts: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  const codeLines: string[] = [];
  let openListType: "ul" | "ol" | null = null;
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      htmlParts.push(`<p>${formatInlineMarkdown(paragraphLines.join(" "))}</p>`);
      paragraphLines = [];
    }
  };

  const closeList = () => {
    if (openListType) {
      htmlParts.push(`</${openListType}>`);
      openListType = null;
    }
  };

  const closeCodeBlock = () => {
    if (codeLines.length > 0) {
      const codeHtml = escapeHtml(codeLines.join("\n"));
      const languageClass = codeLanguage ? ` class="language-${codeLanguage}"` : "";
      htmlParts.push(`<pre><code${languageClass}>${codeHtml}</code></pre>`);
      codeLines.length = 0;
      codeLanguage = "";
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        closeCodeBlock();
        inCodeBlock = false;
      } else {
        flushParagraph();
        closeList();
        inCodeBlock = true;
        codeLanguage = trimmed.slice(3).trim();
        codeLines.length = 0;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6);
      const headingText = headingMatch[2].trim();
      flushParagraph();
      closeList();
      htmlParts.push(`<h${level}>${formatInlineMarkdown(headingText)}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      htmlParts.push("<hr />");
      continue;
    }

    const listMatch = trimmed.match(/^([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const marker = listMatch[1];
      const text = listMatch[2];
      const listType: "ul" | "ol" = marker.endsWith(".") ? "ol" : "ul";
      flushParagraph();
      if (openListType && openListType !== listType) {
        closeList();
      }
      if (!openListType) {
        htmlParts.push(`<${listType}>`);
        openListType = listType;
      }
      htmlParts.push(`<li>${formatInlineMarkdown(text)}</li>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteText = trimmed.replace(/^>\s?/, "");
      flushParagraph();
      closeList();
      htmlParts.push(`<blockquote>${formatInlineMarkdown(quoteText)}</blockquote>`);
      continue;
    }

    paragraphLines.push(line.trim());
  }

  if (inCodeBlock) {
    closeCodeBlock();
  }

  flushParagraph();
  closeList();

  return htmlParts.join("\n");
};

const allDocs: DocEntry[] = Object.entries(markdownModules)
  .map(([path, content]) => {
    const fileName = path.split("/").pop() ?? path;
    const title = extractTitle(content, fileName);
    return {
      id: path,
      fileName,
      title,
      content,
      searchableText: `${title}\n${fileName}\n${content}`.toLowerCase()
    } satisfies DocEntry;
  })
  .sort((a, b) => a.title.localeCompare(b.title));

export default function DocsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(allDocs[0]?.id ?? null);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredDocs = useMemo(() => {
    if (!normalizedSearch) {
      return allDocs;
    }
    return allDocs.filter((doc) => doc.searchableText.includes(normalizedSearch));
  }, [normalizedSearch]);

  useEffect(() => {
    if (filteredDocs.length === 0) {
      return;
    }
    if (!selectedDocId || !filteredDocs.some((doc) => doc.id === selectedDocId)) {
      setSelectedDocId(filteredDocs[0].id);
    }
  }, [filteredDocs, selectedDocId]);

  const activeDoc = useMemo(() => {
    if (!filteredDocs.length) {
      return null;
    }
    return filteredDocs.find((doc) => doc.id === selectedDocId) ?? filteredDocs[0];
  }, [filteredDocs, selectedDocId]);

  return (
    <div className="docs-page">
      <div className="docs-header">
        <h1>Docs</h1>
        <p className="docs-description">Browse project markdown files from the repository root.</p>
        <input
          type="search"
          className="docs-search"
          placeholder="Search titles, filenames, or content..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>
      <div className="docs-content">
        <aside className="docs-list-panel">
          {filteredDocs.length > 0 ? (
            <ul className="docs-list">
              {filteredDocs.map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    className={`docs-list-item${activeDoc?.id === doc.id ? " active" : ""}`}
                    onClick={() => setSelectedDocId(doc.id)}
                  >
                    <span className="docs-list-title">{doc.title}</span>
                    <span className="docs-list-filename">{doc.fileName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="docs-empty">No documents match your search.</div>
          )}
        </aside>
        <section className="docs-viewer">
          {activeDoc ? (
            <article className="docs-article">
              <header className="docs-article-header">
                <h2>{activeDoc.title}</h2>
                <span className="docs-article-filename">{activeDoc.fileName}</span>
              </header>
              <div
                className="docs-markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(activeDoc.content) }}
              />
            </article>
          ) : (
            <div className="docs-empty">No markdown files were found in the repository root.</div>
          )}
        </section>
      </div>
    </div>
  );
}
