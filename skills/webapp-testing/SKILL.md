---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

**This repo (PLOS):** primary automated tests are node-run unit tests (`npm run test:*`, `tests/*.test.ts`). The dev UI runs via `npm run dev` → `http://localhost:1420`（Tauri 桌面壳与纯浏览器加载同一 Vite webview）。Use Playwright here when the user wants browser-level checks of the UI.

To test local web applications, write native Python Playwright scripts.

**Helper Scripts Available**:
- `scripts/with_server.py` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is abslutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
 ├─ Yes → Read HTML file directly to identify selectors
 │ ├─ Success → Write Playwright script using selectors
 │ └─ Fails/Incomplete → Treat as dynamic (below)
 │
 └─ No (dynamic webapp) → Is the server already running?
 ├─ No → Start: `npm run dev`（http://localhost:1420），等待就绪
 │
 └─ Yes → Reconnaissance-then-action:
 1. Navigate and wait for networkidle
 2. Take screenshot or inspect DOM
 3. Identify selectors from rendered state
 4. Execute actions with discovered selectors
```

## Example: Using with_server.py

To start a server, run `--help` first, then use the helper:

**Single server:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Multiple servers (e.g., backend + frontend):**
```bash
python scripts/with_server.py \
 --server "cd backend && python server.py" --port 3000 \
 --server "cd frontend && npm run dev" --port 5173 \
 -- python your_automation.py
```

To create an automation script, include only Playwright logic (servers are managed automatically):
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
 browser = p.chromium.launch(headless=True) # Always launch chromium in headless mode
 page = browser.new_page()
 page.goto('http://localhost:5173') # Server already running and ready
 page.wait_for_load_state('networkidle') # CRITICAL: Wait for JS to execute
 # ... your automation logic
 browser.close()
```

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
 ```python
 page.screenshot(path='/tmp/inspect.png', full_page=True)
 content = page.content()
 page.locator('button').all()
 ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors

## Common Pitfall

❌ **Don't** inspect the DOM before waiting for `networkidle` on dynamic apps
✅ **Do** wait for `page.wait_for_load_state('networkidle')` before inspection

## Best Practices

- **Manage the dev server explicitly** — start `npm run dev` in the background, wait for it to answer on 1420, and clean up when done; do not expect an in-repo wrapper script.
- Use `sync_playwright()` for synchronous scripts
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits: `page.wait_for_selector()` or `page.wait_for_timeout()`

## Reference Files

本 skill 目录当前只含 `SKILL.md`。需要现成 Python 示例时，直接让当前环境给出 Playwright 脚本片段（本文件上方「Example」「Reconnaissance」两节的模式已够覆盖常见场景）。
