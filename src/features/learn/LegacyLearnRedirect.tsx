import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { storage } from '../../stores/useLoopStore';

/**
 * 旧链接兼容：/learn/<id> 与 /learn/<id>/graph
 * 尝试判定：若 id 为资料 id（`doc_*`），重定向到详情页；否则作为章节 id
 */
export default function LegacyLearnRedirect({ variant = 'default' }: { variant?: 'default' | 'graph' }) {
  const navigate = useNavigate();
  const { legacyId } = useParams<{ legacyId: string }>();

  useEffect(() => {
    if (!legacyId) {
      navigate('/learn', { replace: true });
      return;
    }

    // 先判定是否为资料 id
    (async () => {
      try {
        const doc = await storage.getDocument(legacyId);
        if (doc) {
          // 是资料，重定向到详情页
          navigate(`/learn/doc/${legacyId}${variant === 'graph' ? '?tab=knowledge' : ''}`, { replace: true });
          return;
        }
      } catch (e) {
        // 继续尝试作为章节 id
      }

      // 作为章节 id 处理
      if (variant === 'graph') {
        navigate(`/learn/chapter/${legacyId}/graph`, { replace: true });
      } else {
        navigate(`/learn/chapter/${legacyId}`, { replace: true });
      }
    })();
  }, [legacyId, navigate, storage, variant]);

  return null;
}
