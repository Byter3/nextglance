import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import {fileURLToPath} from 'node:url'
import {scopeHostCss} from './scripts/scoped-css.mjs'

export default defineConfig({
  plugins:[vue()],
  base:'./',
  resolve:{dedupe:['vue']},
  css:{postcss:{plugins:[scopeHostCss()]}},
  server:{host:'127.0.0.1',port:5188,strictPort:true,cors:false},
  build:{
    target:'es2022',outDir:'dist',emptyOutDir:true,cssCodeSplit:false,
    lib:{entry:fileURLToPath(new URL('./src/main.ts',import.meta.url)),name:'NextGlance',formats:['iife'],fileName:()=> 'js/nextglance.js',cssFileName:'nextglance'},
    rollupOptions:{output:{inlineDynamicImports:true,assetFileNames:asset=>asset.names?.some(name=>name.endsWith('.css'))?'css/nextglance.css':'assets/[name]-[hash][extname]'}},
  },
})
