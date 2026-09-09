---
name: mcp-builder
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).
license: Complete terms in LICENSE.txt
---

# MCP Server Development Guide

## Overview

To create high-quality MCP (Model Context Protocol) servers that enable LLMs to effectively interact with external services, use this skill. An MCP server provides tools that allow LLMs to access external services and APIs.

## Process - Four Phases

### Phase 1: Deep Research and Planning

- **Agent-Centric Design**: Build for workflows not just API endpoints; optimize for limited context; design actionable error messages; follow natural task subdivisions; use evaluation-driven development.
- **Study MCP Protocol**: Fetch `https://modelcontextprotocol.io/llms-full.txt`
- **Study Framework Docs**: Load MCP Best Practices; for Python load Python SDK README and reference/python_mcp_server.md; for Node/TypeScript load TypeScript SDK README and reference/node_mcp_server.md
- **Study API Documentation**: Exhaustively read the target API docs (auth, rate limits, endpoints, schemas)
- **Implementation Plan**: Tool selection, shared utilities, input/output design (Pydantic/Zod), error handling, character limits/truncation (e.g. 25k tokens)

### Phase 2: Implementation

- Set up project structure (Python: single .py or modules, Pydantic; Node: package.json, tsconfig, Zod)
- Implement core infrastructure first: API helpers, error handling, response formatting, pagination, auth
- Implement tools: define input schema, write docstrings/descriptions, implement logic, add tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
- Follow language-specific best practices from the reference guides

### Phase 3: Review and Refine

- Code quality: DRY, composability, consistency, error handling, type safety, documentation
- Test safely: MCP servers are long-running; use evaluation harness or run in tmux or with timeout
- Use quality checklist from Python/TypeScript guide

### Phase 4: Create Evaluations

- Load reference/evaluation.md. Create 10 evaluation questions: independent, read-only, complex, realistic, verifiable, stable. Output XML format as specified.

## Reference Files

- MCP Protocol: https://modelcontextprotocol.io/llms-full.txt
- reference/mcp_best_practices.md
- Python SDK: https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md
- TypeScript SDK: https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md
- reference/python_mcp_server.md, reference/node_mcp_server.md, reference/evaluation.md
