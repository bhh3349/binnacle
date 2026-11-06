import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 构建产物默认输出到仓库根的 `web/`（后端 -web 指向它即可）。
 * 部署到别处时用环境变量覆盖：
 *   BINNACLE_WEB_OUT=/opt/binnacle/web pnpm build
 */
const outDir = process.env.BINNACLE_WEB_OUT || '../web';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 把体积大且变动少的依赖单独拆包，首屏并行加载 + 缓存友好
        manualChunks: {
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          charts: ['uplot'],
          vendor: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    proxy: {
      '/api': process.env.BINNACLE_API || 'http://127.0.0.1:8090',
      '/ws': { target: process.env.BINNACLE_API || 'http://127.0.0.1:8090', ws: true },
    },
  },
});
