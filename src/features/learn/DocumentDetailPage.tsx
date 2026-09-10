import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { storage } from '../../stores/useLoopStore';
import { useI18n } from '../../i18n';
import { PageContainer } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTab, TabsPanel } from '../../components/ui/tabs';
import { ChevronLeft } from 'lucide-react';
import type { SourceDocument, Chapter, KnowledgeGraph, LearnerState } from '../../domain';

import ContentTab from './detail/ContentTab';
import SplitTab from './detail/SplitTab';
import KnowledgeTab from './detail/KnowledgeTab';
import PapersTab from './detail/PapersTab';

/** 资料详情页：4 个 Tab（资料内容 / 切分结果 / 关键知识点 / 章节测评试卷） */
export default function DocumentDetailPage() {
  const navigate = useNavigate();
  const { docId } = useParams<{ docId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') || 'content') as 'content' | 'split' | 'knowledge' | 'papers';

  const [doc, setDoc] = useState<SourceDocument | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [learner, setLearner] = useState<LearnerState | null>(null);
  const { m: t } = useI18n();

  // 加载数据
  useEffect(() => {
    if (!docId) {
      navigate('/learn');
      return;
    }
    (async () => {
      try {
        const d = await storage.getDocument(docId);
        if (!d) {
          navigate('/learn');
          return;
        }
        setDoc(d);
        const chs = await storage.listChapters(docId);
        setChapters(chs);
        const g = await storage.getGraph();
        setGraph(g);
        const ls = await storage.getLearnerState();
        setLearner(ls);
      } catch (e) {
        console.error('Failed to load document:', e);
        navigate('/learn');
      }
    })();
  }, [docId, storage, navigate]);

  const handleRefresh = async () => {
    if (!doc) return;
    try {
      const d = await storage.getDocument(doc.id);
      if (d) setDoc(d);
      const chs = await storage.listChapters(doc.id);
      setChapters(chs);
      const g = await storage.getGraph();
      setGraph(g);
      const ls = await storage.getLearnerState();
      setLearner(ls);
    } catch (e) {
      console.error('Failed to refresh:', e);
    }
  };

  if (!doc) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center text-ink-3">
          {t.common.loading}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* 顶部工具栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/learn')}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-ink-1">{doc.title}</h1>
            <p className="text-xs text-ink-3">
              {doc.source && `${doc.source} · `}
              {new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
                new Date(doc.importedAt)
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Tab 导航：TabsList/Tab/Panel 必须包裹在 Tabs(Root) 内，否则 Base UI 抛 TabsRootContext is missing */}
      <Tabs
        value={tab}
        onValueChange={(v) => setSearchParams({ tab: String(v) })}
        className="mt-6"
      >
        <TabsList className="grid w-full grid-cols-4">
          {[
            { value: 'content', label: t.learn.detail.tabs.content },
            { value: 'split', label: t.learn.detail.tabs.split },
            { value: 'knowledge', label: t.learn.detail.tabs.knowledge },
            { value: 'papers', label: t.learn.detail.tabs.papers },
          ].map((item) => (
            <TabsTab key={item.value} value={item.value}>
              {item.label}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel value="content" className="mt-4">
          <ContentTab doc={doc} />
        </TabsPanel>
        <TabsPanel value="split" className="mt-4">
          <SplitTab doc={doc} chapters={chapters} learner={learner} onChanged={handleRefresh} />
        </TabsPanel>
        <TabsPanel value="knowledge" className="mt-4">
          <KnowledgeTab doc={doc} chapters={chapters} graph={graph} learner={learner} onChanged={handleRefresh} />
        </TabsPanel>
        <TabsPanel value="papers" className="mt-4">
          <PapersTab chapters={chapters} learner={learner} />
        </TabsPanel>
      </Tabs>
    </PageContainer>
  );
}
