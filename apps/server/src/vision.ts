/**
 * 视觉模型调用（OpenAI 兼容 /chat/completions 的 image_url）。
 * 工作区图片（read_image）与浏览器截图（look_page）共用这条路径，改一处两边都受益。
 * 只在服务端调用：图片字节从不落日志。
 */
export interface VisionResult {
  model?: string;
  answer?: string;
  error?: string;
}

export async function lookAtImage(
  bytes: Uint8Array,
  mimeType: string,
  question: string,
  signal: AbortSignal,
): Promise<VisionResult> {
  const base = process.env.OPENAI_BASE_URL?.replace(/\/+$/, "");
  if (!base) return { error: "未配置 OPENAI_BASE_URL，无法做图片理解" };
  const model = process.env.VISION_MODEL ?? "meta/llama-3.2-11b-vision-instruct";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.OPENAI_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: question },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
                },
              },
            ],
          },
        ],
        max_tokens: 800,
      }),
      signal,
    });
    if (!res.ok)
      return { error: `视觉模型调用失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}` };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { model, answer: data?.choices?.[0]?.message?.content ?? "（模型没有返回内容）" };
  } catch (error) {
    return { error: `图片理解失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
