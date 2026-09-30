/**
 * 网页版没有可靠的系统触感（navigator.vibrate 多数桌面浏览器不支持），
 * 这里全部是空实现，保证同一套调用在网页端编译运行正常。
 */
export function setHapticsEnabled(_value: boolean) {
  void _value;
}
export function hapticTap() {}
export function hapticPress() {}
export function hapticSuccess() {}
export function hapticWarn() {}
