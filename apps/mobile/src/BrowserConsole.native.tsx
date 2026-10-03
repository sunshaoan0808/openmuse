import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { ErrorNotice } from "./ui";
export default function BrowserConsole({ url }: { url: string }) {
  const [error, setError] = useState("");
  return (
    <View>
      <ErrorNotice error={error} />
      <WebView
        source={{ uri: url }}
        onError={(event) => setError(event.nativeEvent.description)}
        // 面板正文也会滚：开启嵌套滚动，让页面先吃手势（Android）
        nestedScrollEnabled
        style={{ height: 520, borderRadius: 12 }}
      />
    </View>
  );
}
