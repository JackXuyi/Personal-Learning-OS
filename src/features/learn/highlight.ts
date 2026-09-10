/**
 * 原文高亮（highlight）—— 在**渲染结果 DOM** 中按字符区间滚动 + 高亮。
 *
 * 为什么按字符区间而不是按文本匹配：知识点记录的 `start/end` 是
 * `doc.textPreview` 的绝对偏移（`locateQuote` 算出来的），而渲染结果
 * （尤其是 Markdown）会把原文拆成大量文本节点、还会插入语法标点对应的元素。
 * 用 TreeWalker 累加文本节点长度即可把字符偏移映射回 DOM 位置，
 * 对 Markdown / 纯文本 / 代码三种渲染器**同样有效**。
 *
 * 约束：纯 DOM 操作、无 React、无 IO；调用方在 effect 里调用。
 */

const MARK_CLASS = "bg-primary/15 rounded-sm";

/** 清除 root 内所有既有高亮（把 <mark> 还原成普通文本，避免层层嵌套）。 */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll("mark");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
}

/**
 * 在 root 内高亮 [start, end) 字符区间并滚动到视野中央。
 *
 * @returns 是否命中；区间越界 / 非法 → 返回 false 且**不做任何改动**（不报错）。
 */
export function highlightRange(root: HTMLElement, start: number, end: number): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (start < 0 || end <= start) return false;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;

  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const len = text.data.length;
    if (!startNode && start < acc + len) {
      startNode = text;
      startOffset = start - acc;
    }
    if (startNode && end <= acc + len) {
      endNode = text;
      endOffset = end - acc;
      break;
    }
    acc += len;
    node = walker.nextNode();
  }
  // 起点或终点越界（at 超出正文长度）→ 静默忽略（TC-UC06-02）。
  if (!startNode || !endNode) return false;

  clearHighlights(root);

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const mark = document.createElement("mark");
  mark.className = MARK_CLASS;
  try {
    range.surroundContents(mark);
  } catch {
    // 跨多个节点时 surroundContents 会抛（区间边界落在不同的父节点下）：
    // 先抽出内容塞进 <mark>，再把 <mark> 插回原处。
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }
  mark.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}
