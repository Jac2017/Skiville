import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import fs from 'fs';
import path from 'path';

function copyCesiumBuild() {
  return {
    name: 'copy-cesium-build',
    closeBundle() {
      const src = path.resolve('node_modules/cesium/Build/Cesium');
      const dest = path.resolve('dist/cesium');

      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }

      // Copy key files and directories
      const items = ['Cesium.js', 'Workers', 'ThirdParty', 'Assets', 'Widgets'];
      for (const item of items) {
        const srcPath = path.join(src, item);
        const destPath = path.join(dest, item);
        if (fs.existsSync(srcPath)) {
          fs.cpSync(srcPath, destPath, { recursive: true });
        }
      }
      console.log('[copy-cesium-build] Cesium assets copied to dist/cesium/');
    }
  };
}

export default defineConfig({
  plugins: [cesium(), copyCesiumBuild()],
  base: '/Skiville/',
  server: {
    port: 3000,
    open: true
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true
  }
});
