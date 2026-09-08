/**
 * vault —— API Key 安全持久化（macOS Keychain，经 Rust `vault` 命令）。
 *
 * 动机：API Key 属敏感凭据，不落 localStorage 明文（此前以明文保存）。
 * 桌面端（Tauri）经系统钥匙串读写；纯浏览器预览无钥匙串 → isTauri()
 * 守卫直接走「不支持」路径，由 store 回退到旧明文策略（仅在预览环境）。
 *
 * 约定：
 * - service = "plos"（与 Rust vault.rs SERVICE 一致）；
 * - account = `api:<provider>`（一个供应商一条记录）；
 * - 读写失败向上抛原始错误信息，调用方（store）负责静默降级：
 *   钥匙串不可用不应阻塞设置保存，仅丢失「落盘 Key」能力。
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ApiProviderKind } from "./active";

/** account 归一：一个供应商一条 Keychain 记录。 */
export function vaultAccountFor(provider: ApiProviderKind): string {
  return `api:${provider}`;
}

/** 桌面端才有钥匙串；纯浏览器预览为 false。 */
export function hasKeyring(): boolean {
  return isTauri();
}

/** 写入/更新一条记录；secret 为空串 = 删除（幂等）。 */
export async function vaultSaveSecret(
  provider: ApiProviderKind,
  secret: string,
): Promise<void> {
  if (!hasKeyring()) return;
  await invoke("vault_set_secret", {
    account: vaultAccountFor(provider),
    secret,
  });
}

/** 读取记录；无条目返回 null（= 未配置 Key）。 */
export async function vaultReadSecret(
  provider: ApiProviderKind,
): Promise<string | null> {
  if (!hasKeyring()) return null;
  const secret = await invoke<string | null>("vault_get_secret", {
    account: vaultAccountFor(provider),
  });
  return secret ?? null;
}

/** 删除记录（幂等：无条目也成功）。 */
export async function vaultDeleteSecret(provider: ApiProviderKind): Promise<void> {
  if (!hasKeyring()) return;
  await invoke("vault_delete_secret", {
    account: vaultAccountFor(provider),
  });
}
