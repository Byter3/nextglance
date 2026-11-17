<script setup lang="ts">
import markUrl from './branding/nextglance-mark.svg'

withDefaults(defineProps<{ size?: number }>(), { size: 24 })
</script>

<template>
  <span
    class="nextglance-icon"
    aria-hidden="true"
    :style="{ width: `${size}px`, height: `${size}px`, maskImage: `url(${markUrl})`, WebkitMaskImage: `url(${markUrl})` }"
  />
</template>

<style scoped>
.nextglance-icon {
  display: inline-block;
  flex: none;
  vertical-align: middle;
  background-color: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
}
</style>
