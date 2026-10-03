import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import type { Artifact } from "../../../packages/domain/src";
import { apiUrl, type MuseApi } from "./api";

/** 图片来源：拍照或相册。 */
export type ImageSource = "camera" | "library";

const pickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ["images"],
  allowsMultipleSelection: false,
  quality: 0.85,
};

/**
 * 申请权限并打开相机 / 相册。用户取消返回 undefined，权限被拒会抛出中文错误。
 */
export async function captureImage(
  source: ImageSource,
): Promise<ImagePicker.ImagePickerAsset | undefined> {
  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      source === "camera"
        ? "没有相机权限。请在系统设置里允许 OpenMuse 使用相机后重试。"
        : "没有相册权限。请在系统设置里允许 OpenMuse 访问照片后重试。",
    );
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);
  if (result.canceled) return undefined;
  return result.assets[0];
}

function imageExtension(asset: ImagePicker.ImagePickerAsset) {
  const fromName = /\.([a-z0-9]+)$/i.exec(asset.fileName ?? "")?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromMime = /^image\/([a-z0-9+.-]+)$/i.exec(asset.mimeType ?? "")?.[1]?.toLowerCase();
  if (fromMime === "png" || fromMime === "webp" || fromMime === "gif" || fromMime === "heic")
    return fromMime;
  return "jpg";
}

/**
 * 把选中的图片传到已有的文件上传接口（字段名 file，带 Authorization 头），
 * 返回服务端生成的 artifact（其中的 name 就是后续 read_image 要用的文件名）。
 */
export async function uploadImage(
  api: MuseApi,
  asset: ImagePicker.ImagePickerAsset,
): Promise<Artifact> {
  const name = asset.fileName || `photo-${Date.now()}.${imageExtension(asset)}`;
  const mimeType =
    asset.mimeType || `image/${imageExtension(asset) === "jpg" ? "jpeg" : imageExtension(asset)}`;
  if (Platform.OS === "web") {
    const form = new FormData();
    if (asset.file) form.append("file", asset.file, name);
    else {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("无法读取所选图片，请重新选择。");
      form.append("file", new File([await response.blob()], name, { type: mimeType }), name);
    }
    return api.request<Artifact>("/api/files", form);
  }
  const upload = await FileSystem.uploadAsync(`${apiUrl()}/api/files`, asset.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType,
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const payload = JSON.parse(upload.body || "{}");
  if (upload.status < 200 || upload.status >= 300)
    throw new Error(
      typeof payload.error === "string" ? payload.error : `图片上传失败（HTTP ${upload.status}）。`,
    );
  return payload as Artifact;
}

/** 上传成功后发给智能体的消息：必须带上服务端返回的文件名，read_image 靠它找图。 */
export function imageUploadMessage(artifact: Artifact) {
  return `我上传了一张图片，文件名是「${artifact.name}」（artifact ID: ${artifact.id}）。请调用 read_image 读取这张图片。`;
}

/** DocumentPicker 选出的文件（native 有 uri，web 有 file）。 */
export interface PickedDocument {
  name?: string;
  mimeType?: string;
  uri?: string;
  file?: File | null;
}

/**
 * 任意文档上传——文档/源码/音视频都是一等文件（对照 Muse 的 Extensions 清单），
 * 上传口不该比存储口窄。与 /api/files 的 multipart 契约一致；
 * 类型收不收由服务端的魔数+扩展名嗅探决定，客户端不重复判。
 */
export async function uploadDocument(api: MuseApi, picked: PickedDocument): Promise<Artifact> {
  const name = picked.name || `document-${Date.now()}`;
  if (Platform.OS === "web") {
    const form = new FormData();
    if (picked.file) form.append("file", picked.file, name);
    else if (picked.uri) {
      const response = await fetch(picked.uri);
      if (!response.ok) throw new Error("无法读取所选文件，请重新选择。");
      form.append(
        "file",
        new File([await response.blob()], name, {
          type: picked.mimeType || "application/octet-stream",
        }),
        name,
      );
    } else throw new Error("无法读取所选文件，请重新选择。");
    return api.request<Artifact>("/api/files", form);
  }
  if (!picked.uri) throw new Error("无法读取所选文件，请重新选择。");
  const upload = await FileSystem.uploadAsync(`${apiUrl()}/api/files`, picked.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: picked.mimeType || "application/octet-stream",
    headers: { Authorization: `Bearer ${api.token}` },
  });
  const payload = JSON.parse(upload.body || "{}");
  if (upload.status < 200 || upload.status >= 300)
    throw new Error(
      typeof payload.error === "string" ? payload.error : `文件上传失败（HTTP ${upload.status}）。`,
    );
  return payload as Artifact;
}

/** 上传成功后发给智能体的消息：报出文件名与 id，工作区工具按它找文件。 */
export function documentUploadMessage(artifact: Artifact) {
  return `我把文件「${artifact.name}」（artifact ID: ${artifact.id}）放进了工作区，需要时请读取它。`;
}
