// Renders AI chat replies as rich text. Models answer in Markdown (**bold**, lists, headings, code);
// the output is sanitized because it is model-generated text going into innerHTML.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.use({ gfm: true, breaks: true });

// Links open in the system browser, never inside the app window.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderChatMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'iframe'] });
}
