import { ScaffoldPage } from "../scaffold";

export default function SpacesPage() {
  return (
    <ScaffoldPage
      title="学习空间"
      subtitle="为生活不同领域分别建立独立的知识库。"
      scope={[
        "存储层就绪：内存 + localStorage 适配器统一在单一接口之后",
        "领域模型支持跨职业 / 学习 / 个人的多个目标",
        "SQLite / 文件系统后端接口已在 src/storage 预留",
      ]}
      nextSteps={[
        "创建一个 Learning Space（名称、描述、图标）",
        "将 PDF / Markdown / TXT / EPUB 导入到空间",
        "文档解析 + 分块（chunking）流水线",
        "列出文档并附带来源引用",
      ]}
    />
  );
}
