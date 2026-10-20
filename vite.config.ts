import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// dev 下前端与生产保持同样的“同源”形态：/v1 代理到本机模型服务、/sd 代理到本机绘图服务。
// 生产由部署服务器 nginx 做同样的反代（前端只发同源请求，见 src/api.ts 的说明）。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/sd': {
        target: 'http://127.0.0.1:1234',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/sd/, ''),
      },
    },
  },
})
