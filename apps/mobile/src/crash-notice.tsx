import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { clearCrashLog, readCrashLog, subscribeCrash } from "./crash-log";
import { Button, Sheet } from "./ui";

/** 上次崩溃的横幅：点开可看栈（方便截图），看完可清空。 */
export function CrashNotice() {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const unsubscribe = subscribeCrash(setText);
    void readCrashLog().then((saved) => {
      if (saved) setText((current) => current ?? saved);
    });
    return () => {
      unsubscribe();
    };
  }, []);
  if (!text) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          backgroundColor: "#FFF1F0",
          borderBottomWidth: 1,
          borderBottomColor: "#FFD9D6",
          paddingVertical: 8,
          paddingHorizontal: 14,
        }}
      >
        <Text style={{ color: "#B42318", fontSize: 13 }}>
          上次发生了一个错误（点开看详情，截图发我即可）
        </Text>
      </Pressable>
      {open && (
        <Sheet title="错误详情" onClose={() => setOpen(false)}>
          <ScrollView style={{ maxHeight: 420 }}>
            <Text selectable style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 17 }}>
              {text}
            </Text>
          </ScrollView>
          <Button
            onPress={() => {
              void clearCrashLog();
              setOpen(false);
            }}
          >
            清空
          </Button>
        </Sheet>
      )}
    </>
  );
}
