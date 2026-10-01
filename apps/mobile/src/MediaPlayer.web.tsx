import { Linking, Text, View } from "react-native";
import { colors, s } from "./ui";

/**
 * Web 版没有 react-native-webview（RN-Web 不支持），也放不了原生 <video>；
 * 这条分支只用于 Web 验收实例，所以给一张说明卡 + 用系统/浏览器打开。
 * 真机走 MediaPlayer.native.tsx（WebView 内联播放）。
 */
export default function MediaPlayer({
  url,
  mimeType,
  name,
}: {
  url: string;
  mimeType: string;
  name: string;
}) {
  const video = mimeType.startsWith("video/");
  return (
    <View
      style={{
        backgroundColor: colors.canvas,
        borderRadius: 12,
        padding: 16,
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <Text style={[s.small, { color: colors.muted }]}>
        {video ? "视频" : "音频"}文件（{mimeType}）不能在 Web 版内联播放；真机会用内置播放器打开。
      </Text>
      <Text
        style={[s.small, { color: colors.blueDark, textDecorationLine: "underline" }]}
        onPress={() => void Linking.openURL(url)}
        accessibilityLabel={`打开 ${name}`}
      >
        在新标签页打开
      </Text>
    </View>
  );
}
