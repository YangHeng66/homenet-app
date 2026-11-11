/*
 * 二维码：生成用 uqr（纯 JS，输出 SVG），扫码用 @capacitor/barcode-scanner（安卓用 ZXing，不依赖 Google Play 服务）。
 * 扫码插件的入口顶层就引了 html5-qrcode（约 400 KB），所以只在点“扫描”时才动态加载，不进首屏包。
 */
import { renderSVG } from 'uqr';

export function qrSvg(text: string): string {
  // 白底黑块、四格静区：深色界面里也要按标准配色，扫码软件才认
  return renderSVG(text, { ecc: 'M', border: 4, pixelSize: 8, whiteColor: '#ffffff', blackColor: '#000000' });
}

/** 扫一次二维码，用户取消时返回 null */
export async function scanQr(): Promise<string | null> {
  const m = await import('@capacitor/barcode-scanner');
  try {
    const r = await m.CapacitorBarcodeScanner.scanBarcode({
      hint: m.CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: '对准 HomeNet 配置二维码',
      cameraDirection: m.CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: m.CapacitorBarcodeScannerScanOrientation.PORTRAIT,
      android: { scanningLibrary: m.CapacitorBarcodeScannerAndroidScanningLibrary.ZXING },
    });
    return r.ScanResult || null;
  } catch (e) {
    if (/cancel/i.test(String((e as { message?: string })?.message ?? e))) return null;
    throw e;
  }
}
