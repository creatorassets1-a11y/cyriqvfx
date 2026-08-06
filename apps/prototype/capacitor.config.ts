import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android shell configuration.
 *
 * The editor runs entirely inside the WebView with no server: `webDir` is the
 * Vite build output, copied into the APK's assets, so the app works with the
 * device in airplane mode from first launch. That is the offline-first promise
 * holding at the packaging level, not just in the code.
 */
const config: CapacitorConfig = {
  appId: 'com.apexedit.editor',
  appName: 'ApexEdit',
  webDir: 'dist',
  android: {
    // The compositor needs a real GPU surface; the WebView gets one by
    // default, but mixed content must stay off since we load nothing remote.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  server: {
    // Serve the bundled assets over a local https origin rather than file://.
    // WebGL2, MediaRecorder and the file picker all behave better in a secure
    // context, and file:// would make them inconsistent across Android versions.
    androidScheme: 'https',
  },
};

export default config;
