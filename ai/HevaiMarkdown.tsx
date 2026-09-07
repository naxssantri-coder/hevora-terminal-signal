import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown renderer for HEVAI answers (UI polish pass - HevaiPanel used to render `turn.answer` as
 * plain whitespace-pre-wrap text, so any bold/heading/bullet/table markdown the model wrote showed
 * up as literal asterisks/hashes/pipes instead of formatting). Every element is remapped to this
 * app's own text/border tokens.
 *
 * Visual consolidation pass (Aug 2026), direct reference: Binance AI / ChatGPT answer screenshots
 * use zero boxes for body text - structure comes entirely from typography (bold numbered headings
 * like "3. GDP headline sesuai ekspektasi", flowing paragraphs, bullets, "->" causal chains). This
 * renderer used to run in the panel's inherited `font-mono` at 12px --text-secondary (dim grey) -
 * read as raw terminal/code output. HevaiPanel no longer forces font-mono on this subtree, and body
 * copy here sits at ~14.5px/--text-primary (bright). Headings dropped their all-caps tracking-wide
 * treatment (a numbered heading in shouting caps doesn't match the reference at all) in favour of
 * plain bold sentence case, matching how a real numbered section title reads. List markers switched
 * from a bare disc/"•" to a small brand-coloured dot span for the same "premium bullet" reason.
 *
 * A markdown TABLE is the one exception to "no boxes" - kept with its border/rounded container
 * because the brief explicitly wants real column-based tables for side-by-side scenario comparisons
 * (see ASK_AI_COMPARISON_TABLE_RULE in server.ts), which is a genuinely different shape from an
 * answer-body wrapper card.
 *
 * remark-gfm is included for tables and strikethrough - both plausible for this app's numeric
 * answers, not speculative extras.
 */
const components: Components = {
  p: ({ children }) => <p className="text-[14.5px] text-[var(--text-primary)] leading-[1.6]">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[var(--text-secondary)]">{children}</em>,
  h1: ({ children }) => (
    <h1 className="text-[15px] font-semibold text-[var(--text-primary)] mt-1 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-[15px] font-semibold text-[var(--text-primary)] mt-1 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-[var(--text-primary)] mt-1 first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => <ul className="space-y-2 pl-0.5 list-none">{children}</ul>,
  ol: ({ children }) => <ol className="space-y-2 pl-4 list-decimal marker:text-[var(--color-brand)] marker:font-semibold">{children}</ol>,
  li: ({ children }) => (
    <li className="text-[14.5px] text-[var(--text-primary)] leading-[1.6] flex gap-2.5">
      <span className="mt-2.5 w-1 h-1 rounded-full bg-[var(--color-brand)] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--color-brand)] hover:underline break-words"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="px-1.5 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[12.5px] text-[var(--accent-gold)]">
      {children}
    </code>
  ),
  hr: () => <hr className="border-[var(--border-subtle)] my-2" />,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
      <table className="w-full text-[12.5px] border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--bg-surface)]">{children}</thead>,
  th: ({ children }) => (
    <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wider text-[10px] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2.5 py-1.5 text-[var(--text-secondary)] border-b border-[var(--border-subtle)]/60">{children}</td>
  ),
};

export const HevaiMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-2.5">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  </div>
);

/**
 * Bug fix (production report, Aug 2026): "*FOMO long*" showed up with literal asterisks instead of
 * italic. Root cause was never the markdown parser itself (remark-parse correctly parses single-
 * asterisk emphasis in isolation, verified separately) - it was that HevaiPanel.tsx renders
 * turn.keyPoints (POIN_UTAMA bullets), turn.actionConclusion (Tindakan paragraph) and
 * turn.followUpQuestions (chip labels) as PLAIN interpolated strings, never through HevaiMarkdown
 * above. Nothing in the prompt tells the model those three fields are special/plain-text-only, so
 * it naturally reaches for the same bold/italic emphasis it uses everywhere else in an answer - the
 * fix is to make those spots markdown-aware too, not to tell the model to stop.
 *
 * Deliberately a SEPARATE, minimal component rather than reusing HevaiMarkdown directly: these are
 * short inline excerpts (a bullet, one paragraph, a chip label), not multi-paragraph bodies - they
 * don't need headings/lists/tables, and wrapping one in HevaiMarkdown's block-level `space-y-2.5`
 * container would add unwanted vertical spacing inside what's meant to be one bullet/line. The `p`
 * override renders as a bare fragment for exactly that reason - the caller (a <span>/<li>/button
 * text node) already provides its own layout.
 */
const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand)] hover:underline break-words">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[0.92em] text-[var(--accent-gold)]">
      {children}
    </code>
  ),
};

export const HevaiInlineMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineComponents}>
    {text}
  </ReactMarkdown>
);
