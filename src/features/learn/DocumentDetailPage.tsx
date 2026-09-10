import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { storage } from '../../stores/useLoopStore';
import { useI18n } from '../../i18n';
import { PageContainer } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { TabsList } from '../../components/ui/tabs';
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

      {/* Tab 导航 */}
      <TabsList className="mt-6 grid w-full grid-cols-4">
        {[
          { value: 'content' as const, label: t.learn.detail.tabs.content },
          { value: 'split' as const, label: t.learn.detail.tabs.split },
          { value: 'knowledge' as const, label: t.learn.detail.tabs.knowledge },
          { value: 'papers' as const, label: t.learn.detail.tabs.papers },
        ].map((item) => (
          <button
            key={item.value}
            onClick={() => setSearchParams({ tab: item.value })}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              tab === item.value
                ? 'bg-primary text-white'
                : 'text-ink-2 hover:bg-subtle'
            }`}
          >
            {item.label}
          </button>
        ))}
      </TabsList>

      {/* Tab 内容 */}
      <div className="mt-4">
        {tab === 'content' && <ContentTab doc={doc} />}
        {tab === 'split' && <SplitTab doc={doc} chapters={chapters} learner={learner} onChanged={handleRefresh} />}
        {tab === 'knowledge' && <KnowledgeTab doc={doc} chapters={chapters} graph={graph} learner={learner} onChanged={handleRefresh} />}
        {tab === 'papers' && <PapersTab chapters={chapters} learner={learner} />}
      </div>
    </PageContainer>
  );
}
