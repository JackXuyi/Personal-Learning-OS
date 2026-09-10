/**
 * 渲染兜底边界 —— 渲染器抛错时降级为纯文本，而不是整页白屏（E7）。
 *
 * 只做这一件事：捕获子树渲染异常 → 调 `fallback(text)`。
 * 不写日志、不重试、不上报（local-first，不出网）。
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  /** 重新渲染的 key（正文或格式变化时重置错误态）。 */
  resetKey: string;
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class RenderErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[render] 正文渲染失败，已降级为纯文本：", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
