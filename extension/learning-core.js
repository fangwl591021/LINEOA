/* Local, deterministic QA drafting. No model training or network requests. */
(() => {
  function redact(value, names = []) {
    let text = String(value || "");
    for (const name of names.filter(Boolean)) text = text.split(name).join("[姓名]");
    return text
      .replace(/U[0-9a-f]{32}/gi, "[LINE UID]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[電子郵件]")
      .replace(/(?:訂單(?:編號|號碼|號)?|會員編號)\s*[:：]?\s*[A-Z0-9-]{5,}/gi, "[個案編號]")
      .replace(/\b[A-Z][12]\d{8}\b/g, "[身分證號]")
      .replace(/(?:\+886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}/g, "[電話]")
      .replace(/\b[A-Z]?\d{7,}\b/gi, "[個案號碼]")
      .replace(/https?:\/\/\S+/g, "[連結，請人工確認]")
      .trim();
  }

  function draftPairs(records, names = []) {
    const pairs = [];
    let questions = [], answers = [];
    const flush = () => {
      const question = redact(questions.join("\n"), names);
      const answer = redact(answers.join("\n"), names);
      if (question.length >= 4 && answer.length >= 4 && question.length <= 500 && answer.length <= 4000) {
        pairs.push({ question, answer, category: "對話學習" });
      }
      questions = []; answers = [];
    };
    for (const record of records) {
      if (record.role === "customer") {
        if (answers.length) flush();
        questions.push(record.text);
      } else if (record.role === "agent" && questions.length) {
        answers.push(record.text);
      } else flush(); // Unknown sender must not bridge two unrelated fragments.
    }
    flush();
    return pairs.slice(-20);
  }

  function collectBubbles(doc, { left, right, top = 200, bottom, exclude }) {
    const candidates = [];
    for (const element of doc.querySelectorAll("div, p")) {
      if (element.closest(exclude) || element.closest("button,textarea,[contenteditable=true]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 16 || rect.left < left || rect.right > right + 2 || rect.top < top || rect.bottom > bottom) continue;
      const style = doc.defaultView.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      if (Math.max(...[style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].map(parseFloat)) < 8) continue;
      const rgb = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (!rgb || rgb.length < 3 || (rgb.length === 4 && rgb[3] < 0.5)) continue;
      const [r, g, b] = rgb;
      const blue = b - r > 15 && b >= g;
      const gray = Math.max(r, g, b) - Math.min(r, g, b) < 20 && r >= 210 && r <= 248;
      if (!blue && !gray) continue;
      const text = readBubbleText(element);
      if (!text || text.length > 4000 || /^(已讀|今天|昨天|\d{1,2}:\d{2})$/.test(text)) continue;
      const center = (rect.left + rect.right) / 2;
      // Deliberately conservative: labels, cards and ambiguous centered bubbles are not evidence.
      // Long blue staff replies may extend left of the viewport midpoint.
      const role = blue ? "agent"
        : gray && center < (left + right) / 2 ? "customer" : "unknown";
      candidates.push({ element, rect, text, role });
    }
    const records = candidates.filter(item => !candidates.some(parent => parent !== item && parent.element.contains(item.element)))
      .sort((a, b) => a.rect.top - b.rect.top).slice(-40)
      .map(({ text, role }) => ({ text, role }));
    return records.map((record, index) => ({ ...record, text: stripRepeatedQuote(record.text, records.slice(0, index)) }));
  }

  function readBubbleText(element) {
    const selector = 'blockquote,[data-testid*="quote" i],[class*="quoted" i],[class*="quotation" i],[class*="reply-preview" i],[class*="replyPreview"]';
    if (!element.querySelector?.(selector)) return element.innerText?.trim() || "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll(selector).forEach(node => node.remove());
    return clone.textContent?.trim() || "";
  }

  function stripRepeatedQuote(text, previous) {
    // A quoted earlier message has a separate line for the actual reply.
    // Never remove matching words from an ordinary single-line answer.
    for (const record of [...previous].reverse()) {
      if (!record.text || record.text.length < 4) continue;
      const at = text.indexOf(record.text);
      if (at < 0 || at > 80) continue;
      const suffix = text.slice(at + record.text.length);
      const prefix = text.slice(0, at).trim();
      if (/^\s*\n/.test(suffix) && suffix.trim() && prefix.split("\n").length <= 2) return suffix.trim();
    }
    return text;
  }
  globalThis.LINEOA_LEARNING = { redact, draftPairs, collectBubbles, stripRepeatedQuote };
})();
