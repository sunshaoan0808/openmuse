/** 网页版没有应用内取景：调用方看到 hasInAppCamera=false 就走系统相机（ImagePicker）。 */
export const hasInAppCamera = false;

export type CapturedPhoto = { uri: string; fileName: string; mimeType: string };

export type InAppCameraProps = {
  onCancel: () => void;
  onCapture: (photo: CapturedPhoto) => void;
};

export function InAppCamera(_props: InAppCameraProps) {
  return null;
}
