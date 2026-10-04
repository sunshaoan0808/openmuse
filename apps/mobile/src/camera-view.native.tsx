import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { Button } from "./ui";

/** 这个平台有没有应用内取景（网页版没有 → 调用方退回系统相机）。 */
export const hasInAppCamera = true;

/** 应用内相机拍出来的照片：只有 uri/文件名/类型，字节数要另外量（见 limits 的体积预检）。 */
export type CapturedPhoto = { uri: string; fileName: string; mimeType: string };

export type InAppCameraProps = {
  onCancel: () => void;
  onCapture: (photo: CapturedPhoto) => void;
};

/**
 * 应用内取景（对标 Muse 的 `HatchCameraScreenKt` / `HatchCameraPreviewKt` / `HatchCameraLauncherKt`）。
 *
 * 直接甩给系统相机的话，拍完就进工作区了，用户连看一眼的机会都没有；而且权限失败只剩一句
 * catch 出来的中文。这里把取景与快门留在应用里，权限也当场说清楚。
 */
export function InAppCamera({ onCancel, onCapture }: InAppCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  async function shoot() {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.85 });
      if (photo?.uri)
        onCapture({ uri: photo.uri, fileName: `photo-${Date.now()}.jpg`, mimeType: "image/jpeg" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {permission?.granted ? (
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
        ) : (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              padding: 24,
            }}
          >
            <Text style={{ color: "#FFF", textAlign: "center" }}>
              {permission ? "需要相机权限才能拍照。" : "正在检查相机权限…"}
            </Text>
            {!!permission && (
              <Button primary onPress={() => void requestPermission()}>
                允许使用相机
              </Button>
            )}
          </View>
        )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 22,
            paddingBottom: 34,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消拍照"
            onPress={onCancel}
            hitSlop={10}
          >
            <Text style={{ color: "#FFF", fontSize: 15 }}>取消</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="拍照"
            accessibilityState={{ busy, disabled: !permission?.granted || busy }}
            disabled={!permission?.granted || busy}
            onPress={() => void shoot()}
            style={{
              width: 74,
              height: 74,
              borderRadius: 37,
              borderWidth: 4,
              borderColor: "#FFF",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#FFF" }} />
            )}
          </Pressable>
          <View style={{ width: 44 }} />
        </View>
      </View>
    </Modal>
  );
}
