import { Component, type ErrorInfo, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { recordCrash } from "./crash-log";
import { colors, s } from "./ui";

/**
 * 渲染期异常的兜底：release 包里渲染抛错同样是"闪退"。
 * 接住之后把栈显示在屏幕上（可截图），并写进崩溃日志。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { text: string | null }> {
  state: { text: string | null } = { text: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      text: `${error instanceof Error ? error.message : String(error)}\n\n${
        error instanceof Error ? (error.stack ?? "") : ""
      }`,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    recordCrash(error, `[渲染] ${info.componentStack?.slice(0, 300) ?? ""}`);
  }

  render() {
    if (!this.state.text) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 20, paddingTop: 64 }}>
        <Text style={{ fontSize: 20, fontWeight: "600", color: colors.text }}>界面出错了</Text>
        <Text style={[s.muted, { marginTop: 6 }]}>已记录，可以把下面这段截图发给我。</Text>
        <ScrollView style={{ marginTop: 14 }} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text
            selectable
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              lineHeight: 17,
              color: colors.text,
              backgroundColor: "#FFF5F5",
              borderRadius: 10,
              padding: 12,
            }}
          >
            {this.state.text}
          </Text>
        </ScrollView>
      </View>
    );
  }
}
