import "./learning-core.js";

let queue = Promise.resolve();
export function handleLearningMessage(message, sender, api) {
  const operation = queue.then(() => handle(message, sender, api));
  queue = operation.catch(() => {});
  return operation;
}

async function handle(message, sender, { requireToken, apiRequest }) {
  const action = String(message.type).replace("lineoa:learning:", "");
  const privatePage = sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL("learning.html");
  let linePage = false;
  try { const url = new URL(sender.url); linePage = url.protocol === "https:" && (url.hostname === "chat.line.biz" || (action === "open" && url.hostname === "manager.line.biz")); } catch {}
  if (!privatePage && !(linePage && ["add", "open"].includes(action))) throw new Error("不允許的學習操作來源");
  if (action === "open") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("learning.html") });
    return { ok: true };
  }
  const token = await requireToken();
  const session = await apiRequest("/api/auth/me", { token });
  if (!session.user?.id) throw new Error("請重新登入 LINEOA");
  const key = `lineoa_qa_drafts_v1:${session.user.id}`;
  const stored = (await chrome.storage.local.get(key))[key] || { items: [], seen: [] };
  const items = stored.items;
  if (action === "list") return { ok: true, items };
  if (action === "add") {
    if (message.userId !== session.user.id) throw new Error("登入帳號已變更，請重新整理聊天室");
    if (!/^\/U[0-9a-f]{32}\/chat\/U[0-9a-f]{32}\/?$/i.test(new URL(sender.url).pathname)) throw new Error("請開啟一對一聊天室");
    const oa = new URL(sender.url).pathname.split("/")[1];
    if (!/^U[0-9a-f]{32}$/i.test(oa || "")) throw new Error("無法確認官方帳號");
    let added = 0;
    for (const candidate of (Array.isArray(message.items) ? message.items : []).slice(0, 20)) {
      const data = clean(candidate, true);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${oa}\n${data.question}\n${data.answer}`));
      const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      if (stored.seen.includes(fingerprint)) continue;
      if (items.length >= 200) break;
      items.unshift({ ...data, id: crypto.randomUUID(), oa, status: "pending", createdAt: new Date().toISOString() });
      stored.seen.push(fingerprint);
      added++;
    }
    stored.seen = stored.seen.slice(-2000);
    await chrome.storage.local.set({ [key]: stored });
    return { ok: true, added, full: items.length >= 200 };
  }
  const item = items.find(item => item.id === message.id);
  if (!item) throw new Error("找不到草稿，請重新整理");
  if (action === "delete") {
    stored.items = items.filter(row => row.id !== item.id);
  } else if (action === "save" || action === "approve") {
    if (item.status === "approved") throw new Error("已加入題庫，請至知識庫編輯正式 QA");
    Object.assign(item, clean(message.body));
    // Save edits before the remote call so validation or quota failures never erase them.
    await chrome.storage.local.set({ [key]: stored });
    if (action === "approve") {
      if (message.reviewed !== true) throw new Error("請先確認配對、內容與個資均已人工檢查");
      const existing = await apiRequest("/api/knowledge", { token });
      const duplicate = existing.items?.find(row => row.question.trim() === item.question && row.answer.trim() === item.answer);
      if (!duplicate) {
        await apiRequest("/api/knowledge", { token, method: "POST", body: {
          id: item.id, question: item.question, answer: item.answer, category: item.category
        } });
      }
      item.status = "approved";
    }
  } else throw new Error("不支援的學習操作");
  await chrome.storage.local.set({ [key]: stored });
  return { ok: true };
}

function clean(input, sanitize = false) {
  const normalize = value => sanitize ? globalThis.LINEOA_LEARNING.redact(value) : String(value || "").trim();
  const question = normalize(input?.question);
  const answer = normalize(input?.answer);
  if (!question || !answer || question.length > 500 || answer.length > 4000) throw new Error("問題限 1–500 字，答案限 1–4000 字");
  return { question, answer, category: String(input?.category || "對話學習").trim().slice(0, 80) };
}
