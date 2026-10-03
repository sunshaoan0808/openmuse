/**
 * 文件动作的**执行层**——系统分享 / 发布链接 / 导出（对话文件卡与文件详情页共用）。
 * 纯判定与映射在 file-actions.ts（那里零原生依赖、可单测）；本模块静态引 expo 与
 * react-native，只进 App 包、不进单测。
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Linking, Platform } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import type { MuseApi } from "./api";
import { shareExtensionFor, shareMimeTypeFor, shareUtiFor } from "./file-actions";

function contentPath(file: Artifact) {
  return file.url || `/api/files/${file.id}/content`;
}

/** 系统分享：native 下载到缓存（扩展名与类型跟随文件）后交系统面板；web 直接打开。 */
export async function shareArtifactToSystem(api: MuseApi, file: Artifact): Promise<void> {
  if (Platform.OS === "web") {
    await Linking.openURL(api.url(contentPath(file)));
    return;
  }
  // 扩展名与类型要跟着文件走：之前一律存成 .pdf 并声明 PDF，文本文件分享出去会是坏文件
  const extension = shareExtensionFor(file);
  const target = `${FileSystem.cacheDirectory}${file.id}.${extension}`;
  await FileSystem.downloadAsync(api.url(contentPath(file)), target, {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(target, {
      mimeType: shareMimeTypeFor(file, extension),
      UTI: shareUtiFor(file, extension),
    });
  else throw new Error("此设备不支持分享。");
}

/**
 * 发布（或更新发布页设置）：复用既有的发布路由与权限模型（token 即能力，幂等——
 * 重复发布返回同一条链接），这里只是"从对话里发起"的入口，不另立一套权限。
 */
export async function publishArtifact(
  api: MuseApi,
  fileId: string,
  options: { title?: string; description?: string; coverId?: string } = {},
): Promise<string> {
  const result = await api.request<{ url: string }>(`/api/files/${fileId}/publish`, options);
  return result.url;
}

/** 导出为 PDF / HTML：服务端转好落成新文件，返回它（调用方决定是否打开）。 */
export async function exportArtifact(
  api: MuseApi,
  fileId: string,
  format: "pdf" | "html",
): Promise<Artifact> {
  return api.request<Artifact>(`/api/files/${fileId}/export`, { format });
}
