import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { restoreVaultApiKey } from "./stores/useSettingsStore";
import { I18nProvider } from "./i18n";
import "./styles/main.css";

// 启动即从系统钥匙串回填 API Key(桌面端;浏览器预览内部直接跳过)。
// 不阻塞首帧渲染 —— AI 消费发生在用户进入功能之后,此时 Key 必已就绪。
void restoreVaultApiKey();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
