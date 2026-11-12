import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VITE_API_PORT ?? '3333'}`,
    },
  },
  build: {
    rollupOptions: {
      input: {
        site: `${root}index.html`,
        admin: `${root}admin.html`,
        tracking: `${root}acompanhar.html`,
        verifyEmail: `${root}confirmar-email.html`,
        resetPassword: `${root}redefinir-senha.html`,
      },
    },
  },
})
